<script>
  import { onMount, createEventDispatcher } from 'svelte';
  import { api } from '../lib/api.js';
  import { fmtMoney, fmtDate, humanStatus, statusPill } from '../lib/format.js';
  import { navigate } from '../lib/router.js';

  export let view = 'dashboard';
  const dispatch = createEventDispatcher();

  let orders = null;
  let quotes = null;
  let configs = null;
  let error = '';

  onMount(async () => {
    try {
      const [o, q, c] = await Promise.all([
        api('/api/account/orders'),
        api('/api/account/quotes'),
        api('/api/account/configurations'),
      ]);
      orders = o.data || [];
      quotes = q.data || [];
      configs = c.data || [];
    } catch (e) { error = e.message; }
  });

  function nextMilestone(order) {
    if (order.deliveredAt) return { label: 'Delivered', date: order.deliveredAt };
    if (order.shippedAt) return { label: 'Delivered (expected)', date: null };
    if (order.expectedShipAt) return { label: 'Ships', date: order.expectedShipAt };
    if (order.status === 'in_production') return { label: 'In manufacturing', date: null };
    if (order.status === 'awaiting_deposit') return { label: 'Deposit pending', date: null };
    return null;
  }

  $: openQuotes = (quotes || []).filter((q) => q.status === 'sent' && q.expiresAt > Date.now());
  $: activeOrders = (orders || []).filter((o) => o !== null && !['cancelled', 'refunded', 'delivered'].includes(o.status));
</script>

{#if error}
  <div class="acc-banner acc-banner-err">{error}</div>
{/if}

{#if view !== 'orders'}
  <h1 class="acc-h1">Welcome back</h1>
  <p class="acc-muted" style="margin-bottom:16px;">A snapshot of everything in flight.</p>
{:else}
  <h1 class="acc-h1">Orders</h1>
{/if}

{#if orders === null}
  <div class="acc-card"><div class="acc-skel" style="width:60%;"></div></div>
{:else if orders.length === 0}
  <div class="acc-card">
    <h2 class="acc-h2">No orders yet</h2>
    <p class="acc-muted">When you accept a quote and pay your deposit, your order will appear here with full timeline tracking.</p>
    <p style="margin-top:10px;"><a class="acc-link" href="/configure/">Start a configuration →</a></p>
  </div>
{:else}
  <div class="acc-card">
    <h2 class="acc-h2">{view === 'orders' ? 'All orders' : 'Active orders'}</h2>
    <table class="acc-table">
      <thead>
        <tr><th>Order</th><th>Status</th><th>Total</th><th>Next</th><th></th></tr>
      </thead>
      <tbody>
        {#each (view === 'orders' ? orders : activeOrders) as o}
          {@const m = nextMilestone(o)}
          <tr>
            <td><strong>{o.id}</strong><br/><span class="acc-muted">{fmtDate(o.createdAt)}</span></td>
            <td><span class="acc-pill {statusPill(o.status)}">{humanStatus(o.status)}</span></td>
            <td>{fmtMoney(o.totalCents, o.currency, o.fxRate)}</td>
            <td>{m ? `${m.label}${m.date ? ' · ' + fmtDate(m.date) : ''}` : '—'}</td>
            <td><button class="acc-btn" on:click={() => navigate('/orders/' + o.id)}>View</button></td>
          </tr>
        {/each}
        {#if view !== 'orders' && activeOrders.length === 0}
          <tr><td colspan="5" class="acc-muted">No active orders. <a class="acc-link" href="#/orders">See history →</a></td></tr>
        {/if}
      </tbody>
    </table>
  </div>
{/if}

{#if view !== 'orders'}
  <div class="acc-card">
    <h2 class="acc-h2">Open quotes</h2>
    {#if quotes === null}
      <div class="acc-skel" style="width:50%;"></div>
    {:else if openQuotes.length === 0}
      <p class="acc-muted">No active quotes. <a class="acc-link" href="/configure/">Build a configuration</a> and request one.</p>
    {:else}
      <ul class="acc-list">
        {#each openQuotes as q}
          <li class="acc-row" style="justify-content:space-between;">
            <div>
              <strong>{q.id}</strong>
              <span class="acc-muted"> · expires {fmtDate(q.expiresAt)}</span><br/>
              <span class="acc-muted">{fmtMoney(q.totalCents, q.currency, q.fxRate)} total · {fmtMoney(q.depositCents, q.currency, q.fxRate)} deposit</span>
            </div>
            <button class="acc-btn acc-btn-primary" on:click={() => navigate('/quotes')}>Review &amp; pay</button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  <div class="acc-card">
    <h2 class="acc-h2">Saved configurations</h2>
    {#if configs === null}
      <div class="acc-skel" style="width:40%;"></div>
    {:else if configs.length === 0}
      <p class="acc-muted">Configurations you save while signed in show up here, ready to edit, duplicate, or quote.</p>
    {:else}
      <p class="acc-muted">{configs.length} saved · <a class="acc-link" href="#/configurations">Manage →</a></p>
    {/if}
  </div>
{/if}
