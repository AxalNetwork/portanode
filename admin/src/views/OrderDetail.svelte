<script>
  import { onMount } from 'svelte';
  import { fetchOrder, patchOrder, refundEligibility, issueBalance, issueRefund } from '../lib/api.js';
  import { fmtDate, fmtDateTime, fmtMoney, statusPill } from '../lib/format.js';
  import { navigate } from '../lib/router.js';
  import { createEventDispatcher } from 'svelte';

  export let id;
  const dispatch = createEventDispatcher();
  let order = null;
  let elig = null;
  let loading = true;
  let err = '';
  let trackingCarrier = '';
  let trackingNumber = '';
  let trackingUrl = '';
  let refundAmount = '';
  let refundReason = '';
  let refundOverride = false;
  let working = false;

  async function load() {
    loading = true; err = '';
    try {
      const r = await fetchOrder(id);
      order = r.data;
      trackingCarrier = order.trackingCarrier || '';
      trackingNumber = order.trackingNumber || '';
      trackingUrl = order.trackingUrl || '';
      try {
        const e = await refundEligibility(id);
        elig = e.data;
      } catch {}
    } catch (e) {
      err = e.message;
    } finally {
      loading = false;
    }
  }

  async function setStatus(s) {
    working = true;
    try {
      await patchOrder(id, { status: s });
      dispatch('flash', `Status: ${s}`);
      await load();
    } catch (e) { dispatch('flash', 'Failed: ' + e.message); }
    working = false;
  }

  async function saveTracking() {
    working = true;
    try {
      await patchOrder(id, {
        trackingCarrier: trackingCarrier || null,
        trackingNumber: trackingNumber || null,
        trackingUrl: trackingUrl || null,
      });
      dispatch('flash', 'Tracking saved');
      await load();
    } catch (e) { dispatch('flash', 'Failed: ' + e.message); }
    working = false;
  }

  async function balanceInvoice() {
    if (!confirm('Issue 80% balance invoice for this order?')) return;
    working = true;
    try {
      const r = await issueBalance(id, {});
      dispatch('flash', `Invoice ${r.data.id} issued`);
      await load();
    } catch (e) { dispatch('flash', 'Invoice failed: ' + e.message); }
    working = false;
  }

  async function refund() {
    if (!confirm('Issue refund?')) return;
    working = true;
    try {
      const body = { orderId: id, reason: refundReason || undefined, override: refundOverride };
      if (refundAmount) body.amountCents = Math.round(parseFloat(refundAmount) * 100);
      const r = await issueRefund(body);
      dispatch('flash', `Refund ${r.data.id} (${r.data.band})`);
      await load();
    } catch (e) { dispatch('flash', 'Refund failed: ' + e.message); }
    working = false;
  }

  $: id, load();
</script>

<div class="adm-row" style="margin-bottom: 8px;">
  <a class="adm-link" on:click={() => navigate('/pipeline')}>← Pipeline</a>
</div>

{#if err}
  <div class="adm-banner-err">{err}</div>
{:else if loading || !order}
  <p class="adm-muted">Loading…</p>
{:else}
  <h1 class="adm-h1">{order.id}</h1>
  <div class="adm-muted" style="margin-bottom: 12px;">
    <span class="adm-pill adm-pill-{statusPill(order.status)}">{order.status}</span>
    · created {fmtDate(order.createdAt)}
    · <a class="adm-link" on:click={() => navigate('/customers/' + order.customerId)}>customer</a>
  </div>

  <div class="adm-grid-2">
    <div class="adm-card">
      <h2 class="adm-h2">Money</h2>
      <table class="adm-table">
        <tbody>
          <tr><th>Total</th><td>{fmtMoney(order.totalCents, order.currency)}</td></tr>
          <tr><th>Deposit due</th><td>{fmtMoney(order.depositCents, order.currency)}</td></tr>
          <tr><th>Deposit paid</th><td>{fmtMoney(order.depositPaidCents, order.currency)}</td></tr>
          <tr><th>Balance paid</th><td>{fmtMoney(order.balancePaidCents, order.currency)}</td></tr>
          <tr><th>Refunded</th><td>{fmtMoney(order.refundedCents, order.currency)}</td></tr>
        </tbody>
      </table>
    </div>
    <div class="adm-card">
      <h2 class="adm-h2">Status & shipping</h2>
      <div class="adm-row">
        {#each ['awaiting_deposit','in_production','shipping','delivered','cancelled','refunded'] as s}
          <button class="adm-btn"
                  class:adm-btn-primary={order.status === s}
                  disabled={working}
                  on:click={() => setStatus(s)}>{s}</button>
        {/each}
      </div>
      <div style="margin-top: 12px;">
        <label class="adm-label">Carrier</label>
        <input class="adm-input" bind:value={trackingCarrier} placeholder="DHL / UPS / Maersk" />
        <label class="adm-label" style="margin-top: 8px;">Tracking number</label>
        <input class="adm-input" bind:value={trackingNumber} />
        <label class="adm-label" style="margin-top: 8px;">Tracking URL</label>
        <input class="adm-input" bind:value={trackingUrl} type="url" />
        <button class="adm-btn adm-btn-primary" style="margin-top: 10px;" on:click={saveTracking} disabled={working}>Save tracking</button>
      </div>
    </div>
  </div>

  <div class="adm-card">
    <h2 class="adm-h2">Balance invoice</h2>
    <p class="adm-muted">Outstanding: {fmtMoney(order.totalCents - order.depositPaidCents - order.balancePaidCents, order.currency)}</p>
    <button class="adm-btn adm-btn-primary" on:click={balanceInvoice} disabled={working}>Issue 80% balance invoice</button>
  </div>

  <div class="adm-card">
    <h2 class="adm-h2">Refund</h2>
    {#if elig}
      <p class="adm-muted">Policy band: <strong>{elig.band}</strong> · max {fmtMoney(elig.maxRefundCents, order.currency)} — {elig.reason}</p>
    {/if}
    <div class="adm-grid-2">
      <div>
        <label class="adm-label">Amount (USD)</label>
        <input class="adm-input" type="number" step="0.01" placeholder="Full eligible if blank" bind:value={refundAmount} />
      </div>
      <div>
        <label class="adm-label">Reason</label>
        <input class="adm-input" bind:value={refundReason} />
      </div>
    </div>
    <label style="margin-top: 8px; display: inline-flex; gap: 6px; align-items: center;">
      <input type="checkbox" bind:checked={refundOverride} /> Override policy band
    </label>
    <div>
      <button class="adm-btn adm-btn-danger" style="margin-top: 10px;" on:click={refund} disabled={working}>Issue refund</button>
    </div>
  </div>
{/if}
