<script>
  import { onMount, createEventDispatcher } from 'svelte';
  import {
    fetchKybPending,
    patchOrderKyb,
    fetchSanctionsScreenings,
    patchSanctionsScreening,
    fetchRestrictedCountries,
    putRestrictedCountries,
    fetchRestrictedBlocks,
  } from '../lib/api.js';
  import { fmtDateTime, fmtMoney } from '../lib/format.js';

  const dispatch = createEventDispatcher();

  let kyb = [];
  let screenings = [];
  let countries = { list: [], blocked: [], allowed: [], defaults: [] };
  let blocks = [];
  let loading = true;
  let err = '';
  let blockedInput = '';
  let allowedInput = '';

  async function load() {
    loading = true; err = '';
    try {
      const [k, s, c, b] = await Promise.all([
        fetchKybPending(),
        fetchSanctionsScreenings(),
        fetchRestrictedCountries(),
        fetchRestrictedBlocks(),
      ]);
      kyb = k.data || [];
      screenings = s.data || [];
      countries = c.data || countries;
      blocks = b.data || [];
      blockedInput = (countries.blocked || []).join(', ');
      allowedInput = (countries.allowed || []).join(', ');
    } catch (e) { err = e.message; }
    loading = false;
  }
  onMount(load);

  async function setKyb(id, status) {
    if (!confirm(`Mark KYB ${status} for ${id}?`)) return;
    try { await patchOrderKyb(id, { status }); dispatch('flash', `KYB ${status}`); await load(); }
    catch (e) { dispatch('flash', 'Failed: ' + e.message); }
  }
  async function setScreening(id, status, customerStatus) {
    try { await patchSanctionsScreening(id, { status, customerStatus });
      dispatch('flash', 'Screening updated'); await load(); }
    catch (e) { dispatch('flash', 'Failed: ' + e.message); }
  }
  function parseList(s) {
    return s.split(/[\s,]+/).map((x) => x.trim().toUpperCase()).filter((x) => x.length === 2);
  }
  async function saveCountries() {
    try {
      await putRestrictedCountries({ blocked: parseList(blockedInput), allowed: parseList(allowedInput) });
      dispatch('flash', 'Restricted list saved');
      await load();
    } catch (e) { dispatch('flash', 'Failed: ' + e.message); }
  }
</script>

<section class="adm-section">
  <h1>Compliance</h1>
  {#if err}<p class="adm-err">{err}</p>{/if}
  {#if loading}<p class="adm-muted">Loading…</p>{:else}

  <h2>KYB pending ({kyb.length})</h2>
  {#if kyb.length === 0}
    <p class="adm-muted">No orders awaiting KYB clearance.</p>
  {:else}
    <table class="adm-table">
      <thead><tr><th>Order</th><th>Total</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead>
      <tbody>
      {#each kyb as o (o.id)}
        <tr>
          <td><a href="#/orders/{o.id}">{o.id}</a></td>
          <td>{fmtMoney(o.total_cents, o.currency)}</td>
          <td>{o.kyb_status}</td>
          <td>{fmtDateTime(o.created_at)}</td>
          <td>
            <button class="adm-btn" on:click={() => setKyb(o.id, 'cleared')}>Clear</button>
            <button class="adm-btn is-danger" on:click={() => setKyb(o.id, 'rejected')}>Reject</button>
          </td>
        </tr>
      {/each}
      </tbody>
    </table>
  {/if}

  <h2 style="margin-top:24px;">Sanctions screenings ({screenings.length})</h2>
  <table class="adm-table">
    <thead><tr><th>When</th><th>Customer</th><th>Status</th><th>Top score</th><th>Matches</th><th>Actions</th></tr></thead>
    <tbody>
    {#each screenings as s (s.id)}
      <tr>
        <td>{fmtDateTime(s.createdAt)}</td>
        <td>{s.queryName}</td>
        <td>{s.status}</td>
        <td>{s.topScore != null ? s.topScore.toFixed(2) : '—'}</td>
        <td>{s.matchCount}</td>
        <td>
          <button class="adm-btn" on:click={() => setScreening(s.id, 'clear', 'clear')}>Clear</button>
          <button class="adm-btn" on:click={() => setScreening(s.id, 'matched', 'review')}>Match</button>
          <button class="adm-btn is-danger" on:click={() => setScreening(s.id, 'escalated', 'blocked')}>Escalate</button>
        </td>
      </tr>
    {/each}
    </tbody>
  </table>

  <h2 style="margin-top:24px;">Restricted countries</h2>
  <p class="adm-muted">ISO-2 codes, comma-separated. Defaults: {countries.defaults.join(', ')}.</p>
  <label style="display:block;margin-top:8px;">Blocked overrides<br>
    <input type="text" bind:value={blockedInput} style="width:100%;font-family:monospace;" />
  </label>
  <label style="display:block;margin-top:8px;">Allowed overrides (carve-outs)<br>
    <input type="text" bind:value={allowedInput} style="width:100%;font-family:monospace;" />
  </label>
  <button class="adm-btn is-primary" on:click={saveCountries} style="margin-top:8px;">Save</button>

  <h2 style="margin-top:24px;">Recent blocks ({blocks.length})</h2>
  <table class="adm-table">
    <thead><tr><th>When</th><th>Country</th><th>Source</th><th>Email</th><th>Customer</th></tr></thead>
    <tbody>
    {#each blocks as b (b.id)}
      <tr>
        <td>{fmtDateTime(b.created_at)}</td>
        <td>{b.country}</td>
        <td>{b.list_source}</td>
        <td>{b.email || '—'}</td>
        <td>{b.customer_id || '—'}</td>
      </tr>
    {/each}
    </tbody>
  </table>

  {/if}
</section>
