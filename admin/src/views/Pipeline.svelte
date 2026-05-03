<script>
  import { onMount } from 'svelte';
  import { fetchOrders, fetchQuotes, patchOrder } from '../lib/api.js';
  import { fmtMoney, fmtDate } from '../lib/format.js';
  import { navigate } from '../lib/router.js';
  import { createEventDispatcher } from 'svelte';

  const dispatch = createEventDispatcher();
  // Pipeline columns. Quotes feed Lead / Qualified / Quote sent; orders fill
  // the rest. Customer-facing labels match the names ops use on the phone
  // ("deposit paid", "manufacturing", "shipped", "closed") and map to the
  // canonical D1 status enum (`awaiting_deposit|reserved`, `in_production`,
  // `shipping`, `delivered`, `cancelled`). Drag-and-drop only writes status
  // for order columns — quote columns reflect derived state.
  const COLUMNS = [
    { id: 'lead', label: 'Lead', kind: 'quote', match: (q) => q.status === 'draft' },
    { id: 'qualified', label: 'Qualified', kind: 'quote', match: (q) => q.status === 'sent' && !q.sentAt },
    { id: 'quote_sent', label: 'Quote sent', kind: 'quote', match: (q) => q.status === 'sent' && !!q.sentAt },
    {
      id: 'deposit_paid',
      label: 'Deposit paid',
      kind: 'order',
      // Stripe webhook moves orders to `reserved` after deposit lands,
      // while older or manually-created orders may still sit in
      // `awaiting_deposit`. Both belong in this column; dragging cards
      // here from elsewhere normalises them to `reserved` (post-deposit).
      orderStatus: 'reserved',
      match: (o) => o.status === 'reserved' || o.status === 'awaiting_deposit',
    },
    {
      id: 'manufacturing',
      label: 'Manufacturing',
      kind: 'order',
      orderStatus: 'in_production',
      match: (o) => o.status === 'in_production',
    },
    {
      id: 'shipped',
      label: 'Shipped',
      kind: 'order',
      orderStatus: 'shipping',
      match: (o) => o.status === 'shipping',
    },
    {
      id: 'delivered',
      label: 'Delivered',
      kind: 'order',
      orderStatus: 'delivered',
      match: (o) => o.status === 'delivered',
    },
    {
      id: 'closed',
      label: 'Closed',
      kind: 'order',
      orderStatus: 'cancelled',
      match: (o) => o.status === 'cancelled' || o.status === 'refunded',
    },
  ];

  let orders = [];
  let quotes = [];
  let loading = true;
  let err = '';
  let dragging = null;

  async function load() {
    loading = true; err = '';
    try {
      const [o, q] = await Promise.all([fetchOrders(), fetchQuotes()]);
      orders = o.data;
      quotes = q.data;
    } catch (e) {
      err = e.message;
    } finally {
      loading = false;
    }
  }

  function colItems(col) {
    if (col.kind === 'quote') return quotes.filter(col.match);
    return orders.filter(col.match);
  }

  function onDragStart(e, item, kind) {
    dragging = { id: item.id, kind };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', item.id);
  }
  function onDragOver(e, col) {
    if (!dragging || dragging.kind !== 'order' || col.kind !== 'order') return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }
  async function onDrop(e, col) {
    e.preventDefault();
    if (!dragging) return;
    if (dragging.kind !== 'order' || col.kind !== 'order') {
      dragging = null;
      return;
    }
    const id = dragging.id;
    const newStatus = col.orderStatus;
    const order = orders.find((o) => o.id === id);
    if (!order || order.status === newStatus) { dragging = null; return; }
    const prev = order.status;
    order.status = newStatus;
    orders = orders;
    try {
      await patchOrder(id, { status: newStatus });
      dispatch('flash', `${id}: ${prev} → ${newStatus}`);
    } catch (e2) {
      order.status = prev;
      orders = orders;
      dispatch('flash', 'Move failed: ' + e2.message);
    }
    dragging = null;
  }

  onMount(load);
</script>

<h1 class="adm-h1">Pipeline</h1>

{#if err}<div class="adm-banner-err">{err}</div>{/if}
{#if loading}
  <p class="adm-muted">Loading…</p>
{:else}
  <div class="adm-kanban">
    {#each COLUMNS as col}
      <div class="adm-kcol"
           class:drop-target={dragging?.kind === 'order' && col.kind === 'order'}
           on:dragover={(e) => onDragOver(e, col)}
           on:drop={(e) => onDrop(e, col)}
           role="list">
        <h3>
          <span>{col.label}</span>
          <span>{colItems(col).length}</span>
        </h3>
        {#each colItems(col) as item (item.id)}
          {#if col.kind === 'order'}
            <div class="adm-kcard"
                 draggable="true"
                 on:dragstart={(e) => onDragStart(e, item, 'order')}
                 on:click={() => navigate('/orders/' + item.id)}
                 role="button" tabindex="0">
              <div><strong>{item.id}</strong></div>
              <div>{fmtMoney(item.totalCents, item.currency)}</div>
              <div class="meta">{fmtDate(item.createdAt)} · {item.region}</div>
            </div>
          {:else}
            <div class="adm-kcard"
                 on:click={() => navigate('/customers/' + encodeURIComponent(item.contact?.email || ''))}
                 role="button" tabindex="0">
              <div><strong>{item.id}</strong></div>
              <div>{item.contact?.company || item.contact?.email || '—'}</div>
              <div class="meta">{fmtMoney(item.totalCents, item.currency)} · {fmtDate(item.createdAt)}</div>
            </div>
          {/if}
        {/each}
      </div>
    {/each}
  </div>
{/if}
