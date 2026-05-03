<script>
  import { onMount } from 'svelte';
  import { fetchDashboard, triggerDigest, triggerSnapshot } from '../lib/api.js';
  import { fmtMoney } from '../lib/format.js';
  import { createEventDispatcher } from 'svelte';

  const dispatch = createEventDispatcher();
  let data = null;
  let loading = true;
  let err = '';

  async function load() {
    loading = true; err = '';
    try {
      const r = await fetchDashboard();
      data = r.data;
    } catch (e) {
      err = e.message || 'Failed to load';
    } finally {
      loading = false;
    }
  }

  async function runDigest() {
    try {
      const r = await triggerDigest();
      dispatch('flash', r.data.sent ? `Digest sent (${r.data.counts.overdue} overdue)` : 'No tasks to digest');
    } catch (e) { dispatch('flash', 'Digest failed: ' + e.message); }
  }
  async function runSnapshot() {
    try {
      const r = await triggerSnapshot();
      dispatch('flash', `Snapshot: ${r.data.sizeBytes} bytes`);
    } catch (e) { dispatch('flash', 'Snapshot failed: ' + e.message); }
  }

  onMount(load);

  function pct(n) {
    if (n == null || isNaN(n)) return '—';
    return (n * 100).toFixed(1) + '%';
  }
</script>

<h1 class="adm-h1">Dashboard</h1>

{#if loading}
  <p class="adm-muted">Loading…</p>
{:else if err}
  <div class="adm-banner-err">{err}</div>
{:else if data}
  <div class="adm-grid-4">
    <div class="adm-stat">
      <div class="l">Leads / week</div>
      <div class="n">{data.weekly.leads}</div>
    </div>
    <div class="adm-stat">
      <div class="l">Quotes / week</div>
      <div class="n">{data.weekly.quotes}</div>
    </div>
    <div class="adm-stat">
      <div class="l">Orders / week</div>
      <div class="n">{data.weekly.orders}</div>
    </div>
    <div class="adm-stat">
      <div class="l">Deposit pipeline</div>
      <div class="n">{fmtMoney(data.depositPipelineCents)}</div>
    </div>
  </div>

  <div class="adm-card" style="margin-top: 16px;">
    <h2 class="adm-h2">Conversion funnel</h2>
    <div class="adm-grid-3">
      <div>
        <div class="adm-muted">Lead → Quote</div>
        <div style="font-size: 1.4rem; font-weight: 600;">{pct(data.conversion.leadToQuote)}</div>
      </div>
      <div>
        <div class="adm-muted">Quote → Order</div>
        <div style="font-size: 1.4rem; font-weight: 600;">{pct(data.conversion.quoteToOrder)}</div>
      </div>
      <div>
        <div class="adm-muted">Order → Won</div>
        <div style="font-size: 1.4rem; font-weight: 600;">{pct(data.conversion.orderToWon)}</div>
      </div>
    </div>
  </div>

  <div class="adm-grid-2" style="margin-top: 16px;">
    <div class="adm-card">
      <h2 class="adm-h2">Leads by source</h2>
      <table class="adm-table">
        <thead><tr><th>Source</th><th>Count</th></tr></thead>
        <tbody>
          {#each data.leadsBySource as r}
            <tr><td>{r.kind}</td><td>{r.n}</td></tr>
          {:else}
            <tr><td colspan="2" class="adm-muted">No leads yet</td></tr>
          {/each}
        </tbody>
      </table>
    </div>
    <div class="adm-card">
      <h2 class="adm-h2">Orders by status</h2>
      <table class="adm-table">
        <thead><tr><th>Status</th><th>Count</th></tr></thead>
        <tbody>
          {#each data.ordersByStatus as r}
            <tr><td>{r.status}</td><td>{r.n}</td></tr>
          {:else}
            <tr><td colspan="2" class="adm-muted">No orders yet</td></tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>

  <div class="adm-card" style="margin-top: 16px;">
    <h2 class="adm-h2">Manual cron triggers</h2>
    <p class="adm-muted">Cloudflare runs these on schedule (daily 08:00 UTC, weekly Mon 06:00 UTC). Trigger them on demand for testing.</p>
    <div class="adm-row">
      <button class="adm-btn" on:click={runDigest}>Run task digest</button>
      <button class="adm-btn" on:click={runSnapshot}>Refresh export snapshot</button>
    </div>
  </div>
{/if}
