<script>
  import { onMount } from 'svelte';
  import { fetchExports, runExport, exportObjectUrl } from '../lib/api.js';
  import { fmtDateTime } from '../lib/format.js';
  import { createEventDispatcher } from 'svelte';

  const dispatch = createEventDispatcher();
  let exports = [];
  let loading = true;
  let working = false;
  let err = '';

  async function load() {
    loading = true; err = '';
    try {
      const r = await fetchExports();
      exports = r.data.sort((a, b) => b.uploaded.localeCompare(a.uploaded));
    } catch (e) { err = e.message; }
    loading = false;
  }

  async function run() {
    working = true;
    try {
      const r = await runExport();
      dispatch('flash', `Export ${r.data.key} (${r.data.sizeBytes} bytes)`);
      await load();
    } catch (e) { dispatch('flash', 'Failed: ' + e.message); }
    working = false;
  }

  onMount(load);
</script>

<h1 class="adm-h1">Exports</h1>

<div class="adm-card">
  <p class="adm-muted">ZIP bundle (one CSV per table) of customers, leads, quotes, orders, invoices, refunds, notes and tasks. Cloudflare's weekly cron rebuilds <code>admin-exports/latest.zip</code> automatically.</p>
  <div class="adm-row">
    <button class="adm-btn adm-btn-primary" on:click={run} disabled={working}>Run export now</button>
    <a class="adm-btn" href={exportObjectUrl('admin-exports/latest.zip')}>Download latest</a>
  </div>
  {#if err}<div class="adm-banner-err" style="margin-top: 10px;">{err}</div>{/if}
  {#if loading}
    <p class="adm-muted" style="margin-top: 10px;">Loading…</p>
  {:else}
    <table class="adm-table" style="margin-top: 12px;">
      <thead><tr><th>Key</th><th>Size</th><th>Uploaded</th><th></th></tr></thead>
      <tbody>
        {#each exports as e}
          <tr>
            <td><code>{e.key}</code></td>
            <td>{Math.round(e.size / 1024)} KB</td>
            <td>{fmtDateTime(new Date(e.uploaded).getTime())}</td>
            <td><a class="adm-btn adm-btn-ghost" href={exportObjectUrl(e.key)}>Download</a></td>
          </tr>
        {:else}<tr><td colspan="4" class="adm-muted" style="text-align:center;">No exports yet — run one.</td></tr>{/each}
      </tbody>
    </table>
  {/if}
</div>
