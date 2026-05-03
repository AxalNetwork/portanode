<script>
  import { onMount, createEventDispatcher } from 'svelte';
  import { api, apiBase } from '../lib/api.js';
  import { fmtMoney, fmtDate, humanStatus, statusPill } from '../lib/format.js';
  import { navigate } from '../lib/router.js';

  export let id;
  const dispatch = createEventDispatcher();

  let data = null;
  let error = '';
  let noteText = '';
  let posting = false;

  // Canonical order timeline. Each milestone resolves to one of three states:
  //   done    — already happened (date taken from the order record)
  //   current — the order is in this phase right now
  //   upcoming
  const STEPS = [
    { key: 'awaiting_deposit', label: 'Deposit', desc: 'Reservation deposit paid' },
    { key: 'in_production', label: 'Manufacturing', desc: 'Slot booked, build in progress' },
    { key: 'balance', label: 'Balance invoice', desc: 'Final 80% invoiced' },
    { key: 'shipping', label: 'Shipping', desc: 'Modules left the factory' },
    { key: 'delivered', label: 'Delivered', desc: 'On site and signed for' },
  ];

  function timeline(o, invoices) {
    if (!o) return [];
    const order = ['awaiting_deposit', 'in_production', 'shipping', 'delivered'];
    const idx = order.indexOf(o.status);
    const balanceInvoice = (invoices || []).find((i) => i.kind === 'balance');
    return STEPS.map((s) => {
      let state = 'upcoming';
      let date = null;
      if (s.key === 'awaiting_deposit') {
        if (o.depositPaidCents > 0) { state = 'done'; date = o.createdAt; }
        else if (o.status === 'awaiting_deposit') state = 'current';
      } else if (s.key === 'in_production') {
        if (idx > 1 || o.status === 'shipping' || o.status === 'delivered') state = 'done';
        else if (o.status === 'in_production') state = 'current';
      } else if (s.key === 'balance') {
        if (balanceInvoice) { state = balanceInvoice.paid_at ? 'done' : 'current'; date = balanceInvoice.issued_at; }
      } else if (s.key === 'shipping') {
        if (o.shippedAt) { state = 'done'; date = o.shippedAt; }
        else if (o.status === 'shipping' || o.expectedShipAt) state = 'current';
      } else if (s.key === 'delivered') {
        if (o.deliveredAt) { state = 'done'; date = o.deliveredAt; }
        else if (o.status === 'delivered') state = 'current';
      }
      return { ...s, state, date };
    });
  }

  async function load() {
    try {
      const r = await api('/api/account/orders/' + encodeURIComponent(id));
      data = r.data;
    } catch (e) { error = e.message; }
  }

  onMount(load);

  async function postNote() {
    if (!noteText.trim()) return;
    posting = true;
    try {
      await api('/api/account/orders/' + encodeURIComponent(id) + '/notes', {
        method: 'POST', body: { body: noteText },
      });
      noteText = '';
      dispatch('flash', 'Message sent to ops');
      await load();
    } catch (e) {
      dispatch('flash', e.message);
    } finally { posting = false; }
  }

  $: order = data?.order;
  $: notes = data?.notes || [];
  $: invoices = data?.invoices || [];
  $: specPdfUrl = data?.specPdfUrl || null;
  $: steps = timeline(order, invoices);
</script>

<button class="acc-btn" style="margin-bottom:12px;" on:click={() => navigate('/orders')}>← All orders</button>

{#if error}
  <div class="acc-banner acc-banner-err">{error}</div>
{:else if !order}
  <div class="acc-card"><div class="acc-skel" style="width:60%;"></div></div>
{:else}
  <h1 class="acc-h1">Order {order.id}</h1>
  <p class="acc-muted">
    Placed {fmtDate(order.createdAt)} ·
    <span class="acc-pill {statusPill(order.status)}">{humanStatus(order.status)}</span>
  </p>

  <div class="acc-card">
    <h2 class="acc-h2">Timeline</h2>
    <div class="acc-timeline">
      {#each steps as step}
        <div class="acc-tl-step {step.state === 'done' ? 'done' : step.state === 'current' ? 'current' : ''}">
          <div class="acc-tl-dot" aria-hidden="true"></div>
          <div>
            <strong>{step.label}</strong>
            {#if step.date}<span class="acc-muted"> · {fmtDate(step.date)}</span>{/if}
            <div class="acc-muted">{step.desc}</div>
          </div>
        </div>
      {/each}
    </div>
  </div>

  <div class="acc-card">
    <div class="acc-row" style="justify-content:space-between;flex-wrap:wrap;gap:8px;">
      <h2 class="acc-h2" style="margin:0;">Spec sheet &amp; documents</h2>
      <div class="acc-row" style="gap:8px;flex-wrap:wrap;">
        {#if specPdfUrl}
          <a class="acc-btn acc-btn-primary" target="_blank" rel="noopener"
             href="{apiBase()}{specPdfUrl}">Spec sheet PDF</a>
        {/if}
        <a class="acc-btn" target="_blank" rel="noopener"
           href="{apiBase()}/api/configurations/{encodeURIComponent(order.configurationId)}">Configuration JSON</a>
      </div>
    </div>
    <p class="acc-muted" style="margin-top:8px;">
      Configuration <code>{order.configurationId}</code> ·
      Region <strong>{(order.region || '').toUpperCase()}</strong> ·
      Currency <strong>{order.currency}</strong>
      {#if !specPdfUrl}<br/><em>Spec sheet PDF will appear once your quote is finalized.</em>{/if}
    </p>
  </div>

  <div class="acc-card">
    <h2 class="acc-h2">Invoices</h2>
    {#if invoices.length === 0}
      <p class="acc-muted">No invoices yet.</p>
    {:else}
      <table class="acc-table">
        <thead><tr><th>Kind</th><th>Issued</th><th>Amount</th><th>Status</th><th>Document</th></tr></thead>
        <tbody>
          {#each invoices as i}
            <tr>
              <td>{i.kind}</td>
              <td>{fmtDate(i.issued_at)}</td>
              <td>{fmtMoney(i.amount_cents, i.currency, order.fxRate)}</td>
              <td>{i.paid_at ? 'Paid ' + fmtDate(i.paid_at) : 'Pending'}</td>
              <td>
                {#if i.pdfUrl}
                  <a class="acc-link" target="_blank" rel="noopener"
                     href="{apiBase()}{i.pdfUrl}">Download PDF</a>
                {:else}
                  <span class="acc-muted">—</span>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>

  <div class="acc-card">
    <h2 class="acc-h2">Shipping &amp; tracking</h2>
    {#if order.shippingAddress}
      <div>
        {order.shippingAddress.recipient || ''}<br/>
        {order.shippingAddress.line1 || ''}{order.shippingAddress.line2 ? ', ' + order.shippingAddress.line2 : ''}<br/>
        {[order.shippingAddress.city, order.shippingAddress.state, order.shippingAddress.postalCode].filter(Boolean).join(', ')}
        <br/>{order.shippingAddress.country || ''}
      </div>
    {:else}
      <p class="acc-muted">Shipping address will be confirmed once you provide it at checkout or on file.</p>
    {/if}
    <p class="acc-muted" style="margin-top:8px;">
      {#if order.shippedAt}Shipped {fmtDate(order.shippedAt)}.{/if}
      {#if order.expectedShipAt && !order.shippedAt}Expected to ship around {fmtDate(order.expectedShipAt)}.{/if}
    </p>
    {#if order.trackingNumber || order.trackingCarrier || order.trackingUrl}
      <div class="acc-card" style="margin-top:12px;background:var(--axal-gray-50, #f6f5fb);">
        <strong>Tracking</strong>
        <div style="margin-top:4px;">
          {#if order.trackingCarrier}<span>{order.trackingCarrier}</span>{/if}
          {#if order.trackingNumber}
            <span class="acc-muted"> · </span>
            <code>{order.trackingNumber}</code>
          {/if}
        </div>
        {#if order.trackingUrl}
          <div style="margin-top:6px;">
            <a class="acc-btn acc-btn-primary" target="_blank" rel="noopener"
               href={order.trackingUrl}>Track shipment</a>
          </div>
        {/if}
      </div>
    {:else if order.shippedAt}
      <p class="acc-muted" style="margin-top:8px;font-size:0.85rem;">
        Tracking details will be posted here as soon as the carrier confirms pickup.
      </p>
    {/if}
  </div>

  <div class="acc-card">
    <h2 class="acc-h2">Message ops</h2>
    <p class="acc-muted">Anything you write here is attached to your order and visible to our operations team.</p>
    <ul class="acc-list">
      {#each notes as n}
        <li>
          <div class="acc-muted" style="font-size:0.75rem;">
            {n.author_kind === 'admin' ? 'AXAL ops' : 'You'} · {fmtDate(n.created_at)}
          </div>
          <div style="white-space:pre-wrap;">{n.body}</div>
        </li>
      {/each}
      {#if notes.length === 0}<li class="acc-muted">No messages yet.</li>{/if}
    </ul>
    <textarea class="acc-textarea" rows="3" placeholder="Write a message to ops…"
              bind:value={noteText} disabled={posting}></textarea>
    <div style="margin-top:8px;">
      <button class="acc-btn acc-btn-primary" on:click={postNote}
              disabled={posting || !noteText.trim()}>
        {posting ? 'Sending…' : 'Send message'}
      </button>
    </div>
  </div>
{/if}
