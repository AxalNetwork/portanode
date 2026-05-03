<script>
  import { onMount, onDestroy } from 'svelte';
  import { catalog, config, evaluation } from '../stores/config.js';

  export let savedId = null;
  export let apiBase = '';
  export let turnstileSiteKey = '';

  let open = false;
  let submitting = false;
  let done = null; // { id, status, url }
  let error = '';

  let form = {
    company: '',
    name: '',
    email: '',
    phone: '',
    country: '',
    deploymentSite: '',
    useCase: '',
    vatId: '',
    expedite: false,
    notes: '',
  };

  // Turnstile state
  let turnstileWidgetId = null;
  let turnstileToken = '';
  let turnstileEl;

  function reset() {
    error = '';
    done = null;
  }

  // Prefill country from cf.country (best effort) so multi-currency derivation
  // matches the visitor's location with manual override still possible.
  onMount(async () => {
    try {
      const r = await fetch(`${apiBase}/api/geo`, { credentials: 'omit' });
      if (r.ok) {
        const j = await r.json();
        if (j.data && j.data.country && !form.country) {
          form = { ...form, country: j.data.country };
        }
      }
    } catch (e) { /* non-fatal */ }
  });

  // Lazily inject the Turnstile script and render the widget when the form opens.
  $: if (open && turnstileSiteKey) ensureTurnstile();

  function ensureTurnstile() {
    if (typeof window === 'undefined') return;
    const render = () => {
      if (!turnstileEl || turnstileWidgetId !== null) return;
      try {
        turnstileWidgetId = window.turnstile.render(turnstileEl, {
          sitekey: turnstileSiteKey,
          theme: 'light',
          callback: (tok) => { turnstileToken = tok; },
          'error-callback': () => { turnstileToken = ''; },
          'expired-callback': () => { turnstileToken = ''; },
        });
      } catch (e) { /* ignore */ }
    };
    if (window.turnstile) {
      // wait a tick for the bind:this element to mount
      setTimeout(render, 0);
      return;
    }
    if (document.querySelector('script[data-axal-turnstile]')) return;
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.defer = true;
    s.dataset.axalTurnstile = '1';
    s.onload = () => setTimeout(render, 0);
    document.head.appendChild(s);
  }

  onDestroy(() => {
    if (turnstileWidgetId !== null && typeof window !== 'undefined' && window.turnstile) {
      try { window.turnstile.remove(turnstileWidgetId); } catch (e) {}
    }
  });

  async function submit() {
    error = '';
    if (!form.company || !form.email || !form.phone || !form.country) {
      error = 'Company, email, phone, and country are required.';
      return;
    }
    if (!/^[A-Za-z]{2}$/.test(form.country)) {
      error = 'Country must be a 2-letter ISO code (e.g. US, DE, MX).';
      return;
    }
    if (turnstileSiteKey && !turnstileToken) {
      error = 'Please complete the human-verification challenge above.';
      return;
    }
    submitting = true;
    try { window.axalTrack && window.axalTrack('quote_requested', { country: form.country, useCase: form.useCase, expedite: !!form.expedite }); } catch (e) {}
    try {
      // Build an inline configuration snapshot from the current store so the
      // worker can persist it on our behalf if `savedId` was never round-
      // tripped through the real /api/configurations endpoint.
      const ev = $evaluation;
      const cat = $catalog || {};
      const inlineConfiguration = {
        source: 'configurator',
        region: ($config.regionId || 'na').toUpperCase(),
        catalogVersion: cat.version || '1.0.0',
        payload: { ...$config },
        totals: {
          priceUsd: ev && ev.totals ? Math.round(ev.totals.grandTotal || 0) : 0,
          weightKg: ev && ev.totals ? Math.round(ev.totals.weightKg || 0) : 0,
          powerKw: ev && ev.totals ? ev.totals.powerDraw || 0 : 0,
          leadTimeWeeks: ev && ev.totals ? ev.totals.leadTimeWeeks || 0 : 0,
        },
      };
      const payload = {
        configurationId: savedId || undefined,
        configuration: savedId ? undefined : inlineConfiguration,
        contact: {
          email: form.email.trim(),
          name: form.name.trim() || undefined,
          company: form.company.trim(),
          phone: form.phone.trim(),
          country: form.country.trim().toUpperCase(),
        },
        deploymentSite: form.deploymentSite.trim() || undefined,
        useCase: form.useCase.trim() || undefined,
        vatId: form.vatId.trim() || undefined,
        expedite: !!form.expedite,
        notes: form.notes.trim() || undefined,
        turnstileToken: turnstileToken || undefined,
      };
      const r = await fetch(`${apiBase}/api/quotes`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(turnstileToken ? { 'cf-turnstile-token': turnstileToken } : {}),
        },
        body: JSON.stringify(payload),
        credentials: 'omit',
      });
      const j = await r.json();
      if (!r.ok) throw new Error((j.error && j.error.message) || `HTTP ${r.status}`);
      done = j.data;
    } catch (e) {
      error = e.message || 'Could not request a formal quote.';
      // Token is single-use — reset for retry.
      if (turnstileWidgetId !== null && typeof window !== 'undefined' && window.turnstile) {
        try { window.turnstile.reset(turnstileWidgetId); } catch (e) {}
      }
      turnstileToken = '';
    } finally {
      submitting = false;
    }
  }
</script>

<div class="cfg-quote-cta">
  {#if !open}
    <button type="button" class="cfg-btn is-primary cfg-btn-quote"
            on:click={() => { reset(); open = true; }}
            disabled={!$evaluation || $evaluation.lineItems.length === 0}>
      Get formal quote
    </button>
    <p class="cfg-quote-hint">We'll email you a signed PDF and a Stripe link to pay your 20% deposit.</p>
  {:else if done}
    <div class="cfg-quote-done" role="status">
      <h3>Quote sent</h3>
      <p>We've emailed <strong>{form.email}</strong> a signed link for quote <code>{done.id}</code>.</p>
      <p>It's valid for 30 days. You can also open it now:</p>
      <p><a href={done.url} target="_blank" rel="noopener" class="cfg-btn is-primary">Open quote</a></p>
    </div>
  {:else}
    <form class="cfg-quote-form" on:submit|preventDefault={submit} novalidate>
      <h3>Request a formal quote</h3>
      <p class="cfg-quote-hint">All fields marked * are required for tax and shipping.</p>

      <div class="cfg-quote-grid">
        <label>Company *<input type="text" bind:value={form.company} required maxlength="200" /></label>
        <label>Your name<input type="text" bind:value={form.name} maxlength="200" /></label>
        <label>Email *<input type="email" bind:value={form.email} required maxlength="200" /></label>
        <label>Phone *<input type="tel" bind:value={form.phone} required maxlength="40" /></label>
        <label>Country (ISO-2) *<input type="text" bind:value={form.country} required maxlength="2" placeholder="US" style="text-transform:uppercase" /></label>
        <label>VAT / Tax ID<input type="text" bind:value={form.vatId} maxlength="32" placeholder="DE123456789" /></label>
      </div>

      <label class="cfg-quote-block">Deployment site
        <input type="text" bind:value={form.deploymentSite} maxlength="400" placeholder="City, region — or coordinates" />
      </label>
      <label class="cfg-quote-block">Use case
        <textarea bind:value={form.useCase} maxlength="2000" rows="3" placeholder="What will this stack run?"></textarea>
      </label>
      <label class="cfg-quote-block">Notes for our team
        <textarea bind:value={form.notes} maxlength="4000" rows="2"></textarea>
      </label>
      <label class="cfg-quote-check">
        <input type="checkbox" bind:checked={form.expedite} />
        <span>Expedite manufacturing (+8% surcharge)</span>
      </label>

      {#if turnstileSiteKey}
        <div bind:this={turnstileEl} class="cfg-quote-turnstile" aria-label="Human verification"></div>
      {/if}

      {#if error}
        <p class="cfg-quote-error" role="alert">{error}</p>
      {/if}

      <div class="cfg-quote-actions">
        <button type="button" class="cfg-btn" on:click={() => (open = false)} disabled={submitting}>Cancel</button>
        <button type="submit" class="cfg-btn is-primary" disabled={submitting}>
          {submitting ? 'Submitting…' : 'Submit quote request'}
        </button>
      </div>
    </form>
  {/if}
</div>

<style>
  .cfg-quote-cta { margin-top: 16px; padding-top: 16px; border-top: 1px solid #e5e7eb; }
  .cfg-btn-quote { width: 100%; padding: 12px; font-size: 15px; font-weight: 600; }
  .cfg-quote-hint { color: #6b7280; font-size: 12px; margin-top: 6px; }
  .cfg-quote-form h3, .cfg-quote-done h3 { margin: 0 0 4px; font-size: 16px; }
  .cfg-quote-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px; }
  .cfg-quote-grid label, .cfg-quote-block { display: flex; flex-direction: column; font-size: 12px; color: #374151; gap: 4px; }
  .cfg-quote-block { margin-top: 8px; }
  .cfg-quote-grid input, .cfg-quote-block input, .cfg-quote-block textarea {
    border: 1px solid #d1d5db; border-radius: 6px; padding: 6px 8px; font-size: 13px; font-family: inherit;
  }
  .cfg-quote-check { display: flex; align-items: center; gap: 8px; margin-top: 10px; font-size: 13px; }
  .cfg-quote-turnstile { margin-top: 12px; min-height: 65px; }
  .cfg-quote-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px; }
  .cfg-quote-error { color: #b91c1c; font-size: 13px; margin-top: 8px; }
  .cfg-quote-done { background: #f5f3ff; border: 1px solid #ddd6fe; border-radius: 8px; padding: 12px; }
  .cfg-quote-done code { background: #fff; padding: 1px 6px; border-radius: 4px; }
</style>
