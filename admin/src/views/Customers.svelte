<script>
  import { onMount } from 'svelte';
  import { searchCustomers } from '../lib/api.js';
  import { fmtDate } from '../lib/format.js';
  import { navigate } from '../lib/router.js';

  let q = '';
  let rows = [];
  let loading = true;
  let err = '';
  let timer;

  async function load() {
    loading = true; err = '';
    try {
      const r = await searchCustomers(q.trim());
      rows = r.data;
    } catch (e) {
      err = e.message;
    } finally {
      loading = false;
    }
  }

  function debounceSearch() {
    clearTimeout(timer);
    timer = setTimeout(load, 200);
  }

  onMount(load);
</script>

<h1 class="adm-h1">Customers</h1>

<div class="adm-card">
  <input class="adm-input" type="search" placeholder="Search by email, name, company…"
         bind:value={q} on:input={debounceSearch} />
  {#if err}<div class="adm-banner-err" style="margin-top: 10px;">{err}</div>{/if}
  {#if loading}
    <p class="adm-muted" style="margin-top: 12px;">Loading…</p>
  {:else}
    <table class="adm-table" style="margin-top: 10px;">
      <thead><tr><th>Email</th><th>Name</th><th>Company</th><th>Region</th><th>Joined</th><th>Last login</th></tr></thead>
      <tbody>
        {#each rows as r (r.id)}
          <tr>
            <td><a class="adm-link" on:click={() => navigate('/customers/' + r.id)}>{r.email}</a></td>
            <td>{r.name || '—'}</td>
            <td>{r.company || '—'}</td>
            <td>{r.region || '—'}</td>
            <td>{fmtDate(r.created_at)}</td>
            <td>{r.last_login_at ? fmtDate(r.last_login_at) : '—'}</td>
          </tr>
        {:else}
          <tr><td colspan="6" class="adm-muted" style="text-align:center;">No customers match.</td></tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>
