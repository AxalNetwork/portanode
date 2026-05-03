<script>
  import { onMount } from 'svelte';
  import { fetchSnapshots, takeSnapshot, diffSnapshots } from '../lib/api.js';
  import { fmtDateTime } from '../lib/format.js';
  import { createEventDispatcher } from 'svelte';

  const dispatch = createEventDispatcher();
  let snapshots = [];
  let diff = null;
  let loading = true;
  let err = '';
  let working = false;
  let fromId = '';
  let liveCatalog = null;

  async function load() {
    loading = true; err = '';
    try {
      const r = await fetchSnapshots();
      snapshots = r.data;
    } catch (e) { err = e.message; }
    loading = false;
  }

  async function loadLiveCatalog() {
    // The static site serves `_data/catalog.json` at /_data/catalog.json (it's
    // included in the assets). Try the canonical static path first.
    try {
      const candidates = ['/assets/configurator/catalog.json', '/_data/catalog.json'];
      for (const u of candidates) {
        const res = await fetch(u);
        if (res.ok) { liveCatalog = await res.json(); return; }
      }
    } catch {}
  }

  async function snapshot() {
    if (!liveCatalog) await loadLiveCatalog();
    if (!liveCatalog) { dispatch('flash', 'Could not load live catalog'); return; }
    working = true;
    try {
      await takeSnapshot(liveCatalog, `Manual snapshot ${new Date().toISOString().slice(0,10)}`);
      await load();
      dispatch('flash', 'Snapshot saved');
    } catch (e) { dispatch('flash', 'Failed: ' + e.message); }
    working = false;
  }

  async function runDiff() {
    if (!liveCatalog) await loadLiveCatalog();
    working = true;
    try {
      const r = await diffSnapshots({ fromId: fromId || null, liveCatalog });
      diff = r.data;
    } catch (e) { dispatch('flash', 'Diff failed: ' + e.message); }
    working = false;
  }

  function fmtPrice(v) {
    if (v == null) return '—';
    return '$' + Number(v).toLocaleString();
  }
  function fmtPct(v) {
    if (v == null) return '—';
    return (v * 100).toFixed(1) + '%';
  }

  onMount(async () => {
    await loadLiveCatalog();
    await load();
    if (snapshots.length) { fromId = snapshots[0].id; await runDiff(); }
  });
</script>

<h1 class="adm-h1">Pricing review</h1>

<div class="adm-card">
  <h2 class="adm-h2">Snapshots</h2>
  <p class="adm-muted">Capture the live <code>catalog.json</code> quarterly so we can diff future price-list reviews against the previous quarter.</p>
  {#if err}<div class="adm-banner-err">{err}</div>{/if}
  {#if loading}
    <p class="adm-muted">Loading…</p>
  {:else}
    <div class="adm-row">
      <button class="adm-btn adm-btn-primary" on:click={snapshot} disabled={working}>Take snapshot now</button>
      {#if liveCatalog}<span class="adm-muted">Live catalog v{liveCatalog.version}</span>{:else}<span class="adm-banner-warn" style="display: inline-block;">Live catalog not loaded</span>{/if}
    </div>
    <table class="adm-table" style="margin-top: 10px;">
      <thead><tr><th>Taken</th><th>Catalog version</th><th>Notes</th><th></th></tr></thead>
      <tbody>
        {#each snapshots as s (s.id)}
          <tr>
            <td>{fmtDateTime(s.takenAt)}</td>
            <td>{s.catalogVersion || '—'}</td>
            <td>{s.notes || '—'}</td>
            <td><button class="adm-btn" on:click={() => { fromId = s.id; runDiff(); }}>Diff vs live</button></td>
          </tr>
        {:else}<tr><td colspan="4" class="adm-muted">No snapshots yet — take one to start tracking.</td></tr>{/each}
      </tbody>
    </table>
  {/if}
</div>

{#if diff}
<div class="adm-card">
  <h2 class="adm-h2">Diff</h2>
  <p class="adm-muted">
    From: {diff.from ? fmtDateTime(diff.from.takenAt) + ' (' + (diff.from.catalogVersion || '—') + ')' : 'none'}
    → To: {diff.to.id === 'live' ? 'live' : fmtDateTime(diff.to.takenAt)}
    · {diff.changes.length} changed module(s)
  </p>
  {#if diff.changes.length}
    <table class="adm-table">
      <thead><tr><th>Module</th><th>Was</th><th>Now</th><th>Δ</th><th>%</th><th>Options changed</th></tr></thead>
      <tbody>
        {#each diff.changes as c}
          <tr>
            <td><strong>{c.moduleName || c.moduleId}</strong></td>
            <td>{fmtPrice(c.fromPrice)}</td>
            <td>{fmtPrice(c.toPrice)}</td>
            <td>{c.delta != null ? fmtPrice(c.delta) : '—'}</td>
            <td>{fmtPct(c.pctChange)}</td>
            <td>
              {#if c.options.length}
                <ul style="margin: 0; padding-left: 16px; font-size: 0.78rem;">
                  {#each c.options as o}
                    <li>{o.label || o.optionId}: {fmtPrice(o.fromDelta)} → {fmtPrice(o.toDelta)}</li>
                  {/each}
                </ul>
              {:else}—{/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {:else}<p class="adm-muted">No price changes detected.</p>{/if}
</div>
{/if}
