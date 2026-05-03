<script>
  import { onMount, createEventDispatcher } from 'svelte';
  import { api } from '../lib/api.js';
  import { fmtMoney, fmtDate, humanStatus, statusPill } from '../lib/format.js';

  const dispatch = createEventDispatcher();
  let quotes = null;
  let error = '';
  let acceptingId = null;

  onMount(async () => {
    try {
      const r = await api('/api/account/quotes');
      quotes = r.data || [];
    } catch (e) { error = e.message; }
  });

  function expired(q) { return q.status === 'expired' || q.expiresAt < Date.now(); }

  async function accept(q) {
    acceptingId = q.id;
    try {
      const r = await api('/api/account/quotes/' + encodeURIComponent(q.id) + '/checkout', { method: 'POST' });
      if (r.data && r.data.url) location.href = r.data.url;
      else throw new Error('No checkout URL returned');
    } catch (e) {
      acceptingId = null;
      dispatch('flash', e.message);
    }
  }
</script>

<h1 class="acc-h1">Quotes</h1>
<p class="acc-muted" style="margin-bottom:16px;">Active quotes, drafts, and accepted history.</p>

{#if error}<div class="acc-banner acc-banner-err">{error}</div>{/if}

{#if quotes === null}
  <div class="acc-card"><div class="acc-skel" style="width:50%;"></div></div>
{:else if quotes.length === 0}
  <div class="acc-card">
    <p class="acc-muted">No quotes yet. <a class="acc-link" href="/configure/">Build a configuration</a> and click "Get a formal quote".</p>
  </div>
{:else}
  <div class="acc-card">
    <table class="acc-table">
      <thead>
        <tr><th>Quote</th><th>Status</th><th>Total</th><th>Deposit</th><th>Expires</th><th></th></tr>
      </thead>
      <tbody>
        {#each quotes as q}
          {@const isExpired = expired(q)}
          <tr>
            <td><strong>{q.id}</strong><br/><span class="acc-muted">{fmtDate(q.createdAt)}</span></td>
            <td>
              <span class="acc-pill {isExpired ? 'acc-pill-danger' : statusPill(q.status)}">
                {isExpired ? 'expired' : humanStatus(q.status)}
              </span>
            </td>
            <td>{fmtMoney(q.totalCents, q.currency, q.fxRate)}</td>
            <td>{fmtMoney(q.depositCents, q.currency, q.fxRate)}</td>
            <td>{fmtDate(q.expiresAt)}</td>
            <td>
              {#if q.status === 'sent' && !isExpired}
                <button class="acc-btn acc-btn-primary"
                        disabled={acceptingId === q.id}
                        on:click={() => accept(q)}>
                  {acceptingId === q.id ? 'Redirecting…' : 'Accept &amp; pay deposit'}
                </button>
              {:else if q.status === 'accepted'}
                <span class="acc-muted">Order placed</span>
              {:else}
                <span class="acc-muted">—</span>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}
