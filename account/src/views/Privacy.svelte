<script>
  import { createEventDispatcher } from 'svelte';
  import { api, downloadExport } from '../lib/api.js';

  const dispatch = createEventDispatcher();
  let exporting = false;
  let deleting = false;
  let confirmText = '';
  let reason = '';
  let deleteRequested = null;
  let error = '';

  async function onExport() {
    exporting = true;
    error = '';
    try {
      await downloadExport();
      dispatch('flash', 'Export downloaded');
    } catch (e) { error = e.message; }
    finally { exporting = false; }
  }

  async function onDelete() {
    if (confirmText !== 'DELETE') {
      error = 'Type DELETE to confirm.';
      return;
    }
    deleting = true;
    error = '';
    try {
      const r = await api('/api/account/delete', { method: 'POST', body: { reason } });
      deleteRequested = r.data;
      dispatch('flash', 'Deletion requested');
    } catch (e) { error = e.message; }
    finally { deleting = false; }
  }
</script>

<h1 class="acc-h1">Privacy</h1>
<p class="acc-muted" style="margin-bottom:16px;">
  Self-service controls under GDPR Articles 15 (access) and 17 (erasure), and the equivalent CCPA/UK rights.
  See our <a class="acc-link" href="/legal/privacy/">Privacy Policy</a> for retention details.
</p>

{#if error}<div class="acc-banner acc-banner-err">{error}</div>{/if}

<div class="acc-card">
  <h2 class="acc-h2">Export your data</h2>
  <p class="acc-muted">Download a JSON file containing your profile, every saved configuration, all quotes, orders, invoices, and order messages on file.</p>
  <button class="acc-btn acc-btn-primary" on:click={onExport} disabled={exporting}>
    {exporting ? 'Preparing…' : 'Download data export (JSON)'}
  </button>
</div>

<div class="acc-card">
  <h2 class="acc-h2">Delete your account</h2>
  {#if deleteRequested}
    <div class="acc-banner acc-banner-info">
      Request <code>{deleteRequested.id}</code> received. Our team will erase your personal
      data within 30 days. Order, invoice, and tax records required by law are retained
      with your name and contact details scrubbed. We'll email confirmation when complete.
    </div>
  {:else}
    <p class="acc-muted">
      This will queue a permanent erasure request. Active orders must be either delivered
      or cancelled before erasure can complete; we'll contact you if anything is in flight.
      Records we're legally required to keep (invoices, tax filings) are retained with
      your personal details replaced by a tombstone.
    </p>
    <label class="acc-label" for="del-reason">Reason (optional)</label>
    <textarea id="del-reason" class="acc-textarea" rows="2" bind:value={reason}></textarea>
    <label class="acc-label" for="del-confirm" style="margin-top:10px;">Type <code>DELETE</code> to confirm</label>
    <input id="del-confirm" class="acc-input" bind:value={confirmText} />
    <div style="margin-top:10px;">
      <button class="acc-btn acc-btn-danger" on:click={onDelete} disabled={deleting || confirmText !== 'DELETE'}>
        {deleting ? 'Submitting…' : 'Request account deletion'}
      </button>
    </div>
  {/if}
</div>
