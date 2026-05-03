<script>
  import { onMount } from 'svelte';
  import { fetchLeads, patchLead } from '../lib/api.js';
  import { fmtDateTime, statusPill } from '../lib/format.js';
  import { navigate } from '../lib/router.js';
  import { createEventDispatcher } from 'svelte';

  const dispatch = createEventDispatcher();
  let leads = [];
  let loading = true;
  let kind = '';
  let status = '';
  let err = '';
  // Sort key + direction. Backend returns by created_at DESC; we re-sort
  // client-side because the page is paginated to a small ceiling and the
  // ops user wants to flip orderings without a round trip.
  let sortKey = 'created_at';
  let sortDir = 'desc';

  async function load() {
    loading = true; err = '';
    try {
      const r = await fetchLeads(kind || undefined, status || undefined);
      leads = applySort(r.data);
    } catch (e) {
      err = e.message;
    } finally {
      loading = false;
    }
  }

  function applySort(rows) {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }

  function changeSort() {
    leads = applySort(leads);
  }

  function toggleSort(key) {
    if (sortKey === key) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortKey = key;
      sortDir = 'desc';
    }
    changeSort();
  }

  async function setStatus(id, s) {
    try {
      await patchLead(id, { status: s });
      const lead = leads.find((l) => l.id === id);
      if (lead) lead.status = s;
      leads = leads;
      dispatch('flash', 'Lead updated');
    } catch (e) {
      dispatch('flash', 'Update failed: ' + e.message);
    }
  }

  onMount(load);
</script>

<h1 class="adm-h1">Inbox</h1>

<div class="adm-card">
  <div class="adm-row" style="margin-bottom: 10px;">
    <label class="adm-label" style="margin: 0;">Source</label>
    <select class="adm-select" style="width: auto;" bind:value={kind} on:change={load}>
      <option value="">All</option>
      <option value="contact">Contact</option>
      <option value="leasing">Leasing</option>
      <option value="spec_download">Spec download</option>
      <option value="newsletter">Newsletter</option>
      <option value="demo_request">Demo request</option>
    </select>
    <label class="adm-label" style="margin: 0;">Status</label>
    <select class="adm-select" style="width: auto;" bind:value={status} on:change={load}>
      <option value="">All</option>
      <option value="new">New</option>
      <option value="contacted">Contacted</option>
      <option value="qualified">Qualified</option>
      <option value="closed">Closed</option>
      <option value="spam">Spam</option>
    </select>
    <label class="adm-label" style="margin: 0;">Sort</label>
    <select class="adm-select" style="width: auto;" bind:value={sortKey} on:change={changeSort}>
      <option value="created_at">Created</option>
      <option value="email">Email</option>
      <option value="company">Company</option>
      <option value="region">Region</option>
      <option value="kind">Source</option>
      <option value="status">Status</option>
    </select>
    <select class="adm-select" style="width: auto;" bind:value={sortDir} on:change={changeSort}>
      <option value="desc">Newest / Z–A</option>
      <option value="asc">Oldest / A–Z</option>
    </select>
    <button class="adm-btn adm-btn-ghost" on:click={load}>Refresh</button>
  </div>

  {#if err}<div class="adm-banner-err">{err}</div>{/if}
  {#if loading}
    <p class="adm-muted">Loading…</p>
  {:else}
    <table class="adm-table">
      <thead>
        <tr>
          <th><button class="adm-btn adm-btn-ghost" style="padding:0;" on:click={() => toggleSort('created_at')}>When {sortKey === 'created_at' ? (sortDir === 'asc' ? '↑' : '↓') : ''}</button></th>
          <th><button class="adm-btn adm-btn-ghost" style="padding:0;" on:click={() => toggleSort('kind')}>Source {sortKey === 'kind' ? (sortDir === 'asc' ? '↑' : '↓') : ''}</button></th>
          <th><button class="adm-btn adm-btn-ghost" style="padding:0;" on:click={() => toggleSort('email')}>Email {sortKey === 'email' ? (sortDir === 'asc' ? '↑' : '↓') : ''}</button></th>
          <th><button class="adm-btn adm-btn-ghost" style="padding:0;" on:click={() => toggleSort('company')}>Company {sortKey === 'company' ? (sortDir === 'asc' ? '↑' : '↓') : ''}</button></th>
          <th><button class="adm-btn adm-btn-ghost" style="padding:0;" on:click={() => toggleSort('region')}>Region {sortKey === 'region' ? (sortDir === 'asc' ? '↑' : '↓') : ''}</button></th>
          <th><button class="adm-btn adm-btn-ghost" style="padding:0;" on:click={() => toggleSort('status')}>Status {sortKey === 'status' ? (sortDir === 'asc' ? '↑' : '↓') : ''}</button></th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {#each leads as l (l.id)}
          <tr>
            <td>{fmtDateTime(l.created_at)}</td>
            <td><span class="adm-pill adm-pill-info">{l.kind}</span></td>
            <td><a class="adm-link" on:click={() => navigate('/customers/' + encodeURIComponent(l.email))}>{l.email}</a></td>
            <td>{l.company || '—'}</td>
            <td>{l.region || '—'}</td>
            <td><span class="adm-pill adm-pill-{statusPill(l.status)}">{l.status}</span></td>
            <td>
              <select class="adm-select" style="width:auto; font-size: 0.78rem;"
                      value={l.status}
                      on:change={(e) => setStatus(l.id, e.target.value)}>
                <option value="new">new</option>
                <option value="contacted">contacted</option>
                <option value="qualified">qualified</option>
                <option value="closed">closed</option>
                <option value="spam">spam</option>
              </select>
            </td>
          </tr>
        {:else}
          <tr><td colspan="7" class="adm-muted" style="text-align:center;">No leads match.</td></tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>
