<script>
  import { onMount, createEventDispatcher } from 'svelte';
  import { api } from '../lib/api.js';
  import { fmtDate } from '../lib/format.js';

  const dispatch = createEventDispatcher();
  let configs = null;
  let error = '';
  let busyId = null;

  async function load() {
    try {
      const r = await api('/api/account/configurations');
      configs = r.data || [];
    } catch (e) { error = e.message; }
  }
  onMount(load);

  async function duplicate(id) {
    busyId = id;
    try {
      const r = await api('/api/account/configurations/' + encodeURIComponent(id) + '/duplicate', { method: 'POST' });
      dispatch('flash', 'Duplicated as ' + r.data.id);
      await load();
    } catch (e) { dispatch('flash', e.message); }
    finally { busyId = null; }
  }

  function modulesSummary(c) {
    const items = c.payload && c.payload.items;
    if (!Array.isArray(items)) return '—';
    return items.map((i) => i.moduleId || i.id || '').filter(Boolean).join(', ') || '—';
  }
</script>

<h1 class="acc-h1">Configurations</h1>
<p class="acc-muted" style="margin-bottom:16px;">Every configuration you've saved while signed in. Edit deep-links into the configurator with the saved id.</p>

{#if error}<div class="acc-banner acc-banner-err">{error}</div>{/if}

{#if configs === null}
  <div class="acc-card"><div class="acc-skel" style="width:50%;"></div></div>
{:else if configs.length === 0}
  <div class="acc-card">
    <p class="acc-muted">Nothing saved yet. <a class="acc-link" href="/configure/">Open the configurator</a> and click "Save".</p>
  </div>
{:else}
  <div class="acc-card">
    <table class="acc-table">
      <thead>
        <tr><th>ID</th><th>Region</th><th>Modules</th><th>Saved</th><th></th></tr>
      </thead>
      <tbody>
        {#each configs as c}
          <tr>
            <td><code>{c.id}</code></td>
            <td>{(c.region || '').toUpperCase()}</td>
            <td class="acc-muted" style="max-width:240px;overflow:hidden;text-overflow:ellipsis;">{modulesSummary(c)}</td>
            <td>{fmtDate(c.createdAt)}</td>
            <td>
              <div class="acc-row">
                <a class="acc-btn" href="/configure/?c={encodeURIComponent(c.id)}">Edit</a>
                <button class="acc-btn" disabled={busyId === c.id} on:click={() => duplicate(c.id)}>
                  {busyId === c.id ? '…' : 'Duplicate'}
                </button>
                <a class="acc-btn" href="/configure/?c={encodeURIComponent(c.id)}#quote">Request quote</a>
              </div>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}
