<script>
  import { onMount, createEventDispatcher } from 'svelte';
  import { api } from '../lib/api.js';

  export let customer;
  const dispatch = createEventDispatcher();

  let profile = null;
  let saving = false;
  let error = '';

  function blankAddress() {
    return { line1: '', line2: '', city: '', state: '', postalCode: '', country: '' };
  }
  function blankShipping() { return { ...blankAddress(), label: '', recipient: '' }; }
  function blankContact() { return { name: '', email: '', phone: '', role: '' }; }

  async function load() {
    try {
      const r = await api('/api/account/profile');
      profile = {
        name: r.data.name || '',
        company: r.data.company || '',
        phone: r.data.phone || '',
        region: r.data.region || '',
        vatId: r.data.vatId || '',
        marketingOptIn: !!r.data.marketingOptIn,
        billingAddress: r.data.billingAddress || blankAddress(),
        shippingAddresses: (r.data.shippingAddresses || []).length ? r.data.shippingAddresses : [blankShipping()],
        contacts: (r.data.contacts || []).length ? r.data.contacts : [],
      };
    } catch (e) { error = e.message; }
  }
  onMount(load);

  function addShipping() { profile.shippingAddresses = [...profile.shippingAddresses, blankShipping()]; }
  function removeShipping(i) { profile.shippingAddresses = profile.shippingAddresses.filter((_, n) => n !== i); }
  function addContact() { profile.contacts = [...profile.contacts, blankContact()]; }
  function removeContact(i) { profile.contacts = profile.contacts.filter((_, n) => n !== i); }

  async function save() {
    saving = true;
    error = '';
    try {
      await api('/api/account/profile', {
        method: 'PATCH',
        body: {
          name: profile.name,
          company: profile.company,
          phone: profile.phone || null,
          region: profile.region || undefined,
          vatId: profile.vatId || null,
          marketingOptIn: profile.marketingOptIn,
          billingAddress: profile.billingAddress,
          shippingAddresses: profile.shippingAddresses.filter((s) => s.line1 || s.city),
          contacts: profile.contacts.filter((c) => c.name && c.email),
        },
      });
      dispatch('flash', 'Profile saved · synced to billing');
      dispatch('updated');
    } catch (e) {
      error = e.message;
    } finally { saving = false; }
  }
</script>

<h1 class="acc-h1">Profile</h1>
<p class="acc-muted" style="margin-bottom:16px;">Edits sync to your Stripe customer record so invoices, tax ids, and shipping always match.</p>

{#if error}<div class="acc-banner acc-banner-err">{error}</div>{/if}

{#if profile === null}
  <div class="acc-card"><div class="acc-skel" style="width:50%;"></div></div>
{:else}
  <form on:submit|preventDefault={save}>
    <div class="acc-card">
      <h2 class="acc-h2">Company &amp; primary contact</h2>
      <div class="acc-grid-2">
        <div>
          <label class="acc-label" for="p-name">Your name</label>
          <input id="p-name" class="acc-input" bind:value={profile.name} />
        </div>
        <div>
          <label class="acc-label" for="p-company">Company</label>
          <input id="p-company" class="acc-input" bind:value={profile.company} />
        </div>
        <div>
          <label class="acc-label" for="p-email">Email (sign-in)</label>
          <input id="p-email" class="acc-input" value={customer.email} disabled />
        </div>
        <div>
          <label class="acc-label" for="p-phone">Phone</label>
          <input id="p-phone" class="acc-input" bind:value={profile.phone} />
        </div>
        <div>
          <label class="acc-label" for="p-region">Default region</label>
          <select id="p-region" class="acc-select" bind:value={profile.region}>
            <option value="">Auto-detect</option>
            <option value="na">North America</option>
            <option value="eu">Europe</option>
            <option value="apac">Asia-Pacific</option>
            <option value="latam">Latin America</option>
            <option value="ssa">Sub-Saharan Africa</option>
            <option value="mena">MENA</option>
            <option value="polar">Polar / extreme</option>
          </select>
        </div>
        <div>
          <label class="acc-label" for="p-vat">VAT / tax id</label>
          <input id="p-vat" class="acc-input" bind:value={profile.vatId} placeholder="e.g. DE123456789" />
        </div>
      </div>
      <div style="margin-top:12px;">
        <label class="acc-row" style="gap:6px;">
          <input type="checkbox" bind:checked={profile.marketingOptIn} />
          <span>Send me product updates and launch news (you can unsubscribe at any time)</span>
        </label>
      </div>
    </div>

    <div class="acc-card">
      <h2 class="acc-h2">Billing address</h2>
      <div class="acc-grid-2">
        <label class="acc-label">Line 1<input class="acc-input" bind:value={profile.billingAddress.line1} /></label>
        <label class="acc-label">Line 2<input class="acc-input" bind:value={profile.billingAddress.line2} /></label>
        <label class="acc-label">City<input class="acc-input" bind:value={profile.billingAddress.city} /></label>
        <label class="acc-label">State / region<input class="acc-input" bind:value={profile.billingAddress.state} /></label>
        <label class="acc-label">Postal code<input class="acc-input" bind:value={profile.billingAddress.postalCode} /></label>
        <label class="acc-label">Country (ISO-2)<input class="acc-input" maxlength="2" placeholder="DE" bind:value={profile.billingAddress.country} /></label>
      </div>
    </div>

    <div class="acc-card">
      <div class="acc-row" style="justify-content:space-between;">
        <h2 class="acc-h2" style="margin:0;">Shipping addresses</h2>
        <button type="button" class="acc-btn" on:click={addShipping}>+ Add address</button>
      </div>
      {#each profile.shippingAddresses as ship, i (i)}
        <div style="margin-top:14px;border-top:1px solid var(--axal-gray-100);padding-top:14px;">
          <div class="acc-grid-2">
            <label class="acc-label">Label<input class="acc-input" bind:value={ship.label} placeholder="HQ, lab, site A…" /></label>
            <label class="acc-label">Recipient<input class="acc-input" bind:value={ship.recipient} /></label>
            <label class="acc-label">Line 1<input class="acc-input" bind:value={ship.line1} /></label>
            <label class="acc-label">Line 2<input class="acc-input" bind:value={ship.line2} /></label>
            <label class="acc-label">City<input class="acc-input" bind:value={ship.city} /></label>
            <label class="acc-label">State / region<input class="acc-input" bind:value={ship.state} /></label>
            <label class="acc-label">Postal code<input class="acc-input" bind:value={ship.postalCode} /></label>
            <label class="acc-label">Country (ISO-2)<input class="acc-input" maxlength="2" bind:value={ship.country} /></label>
          </div>
          {#if profile.shippingAddresses.length > 1}
            <div style="margin-top:8px;text-align:right;">
              <button type="button" class="acc-btn acc-btn-danger" on:click={() => removeShipping(i)}>Remove</button>
            </div>
          {/if}
        </div>
      {/each}
    </div>

    <div class="acc-card">
      <div class="acc-row" style="justify-content:space-between;">
        <h2 class="acc-h2" style="margin:0;">Additional contacts</h2>
        <button type="button" class="acc-btn" on:click={addContact}>+ Add contact</button>
      </div>
      <p class="acc-muted">Procurement, ops, finance — anyone who should be looped in on invoices or shipping notifications.</p>
      {#each profile.contacts as ct, i (i)}
        <div style="margin-top:14px;border-top:1px solid var(--axal-gray-100);padding-top:14px;">
          <div class="acc-grid-2">
            <label class="acc-label">Name<input class="acc-input" bind:value={ct.name} /></label>
            <label class="acc-label">Email<input class="acc-input" type="email" bind:value={ct.email} /></label>
            <label class="acc-label">Phone<input class="acc-input" bind:value={ct.phone} /></label>
            <label class="acc-label">Role<input class="acc-input" bind:value={ct.role} placeholder="Procurement, ops…" /></label>
          </div>
          <div style="margin-top:8px;text-align:right;">
            <button type="button" class="acc-btn acc-btn-danger" on:click={() => removeContact(i)}>Remove</button>
          </div>
        </div>
      {/each}
    </div>

    <div class="acc-card">
      <button class="acc-btn acc-btn-primary" type="submit" disabled={saving}>
        {saving ? 'Saving…' : 'Save changes'}
      </button>
    </div>
  </form>
{/if}
