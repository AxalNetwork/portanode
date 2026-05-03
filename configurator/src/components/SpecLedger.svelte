<script>
  import { config, evaluation, setRegion, setSiteSize, readOnly } from '../stores/config.js';
  import { formatCurrency, formatNumber } from '../lib/catalog.js';
  export let catalog;
  export let onSave = () => {};
  export let onShare = () => {};
  export let onDownloadPdf = () => {};
  export let savedId = null;
  export let shareUrl = '';

  $: ev = $evaluation;
</script>

<h2 id="cfg-ledger-h">Spec Ledger</h2>
<div class="cfg-ledger" aria-labelledby="cfg-ledger-h">
    <div class="field">
      <label for="cfg-region">Region</label>
      <select id="cfg-region" value={$config.regionId} on:change={(e) => setRegion(e.target.value)}>
        {#each catalog.regions as r}
          <option value={r.id}>{r.name}</option>
        {/each}
      </select>
    </div>
    <div class="field">
      <label for="cfg-site">Site size (m², optional)</label>
      <input id="cfg-site" type="number" min="0" inputmode="numeric"
             value={$config.siteSizeM2 ?? ''}
             on:input={(e) => setSiteSize(e.target.value)} />
    </div>

    {#if ev}
      <div class="cfg-bom">
        {#each ev.lineItems as li}
          <div class="cfg-bom-line">
            <span>{li.qty}× {li.name}</span>
            <span class="v">{formatCurrency(li.lineSubtotal, ev.totals.currency)}</span>
          </div>
        {/each}
        {#if ev.lineItems.length === 0}
          <div class="cfg-empty">No modules yet.</div>
        {/if}
      </div>

      <div class="row"><span>Subtotal</span><span class="v">{formatCurrency(ev.totals.subtotal, ev.totals.currency)}</span></div>
      <div class="row"><span>Power draw</span><span class="v">{formatNumber(ev.totals.powerDraw, ' kW')}</span></div>
      {#if ev.totals.powerGen}
        <div class="row"><span>Power generation</span><span class="v">{formatNumber(ev.totals.powerGen, ' kW')}</span></div>
      {/if}
      <div class="row"><span>Weight</span><span class="v">{formatNumber(ev.totals.weightKg / 1000, ' t')}</span></div>
      <div class="row"><span>Footprint</span><span class="v">{formatNumber(ev.totals.footprintM2, ' m²')}</span></div>
      {#if ev.totals.waterDemandLPerDay > 0 || ev.totals.waterStorageL > 0}
        <div class="row"><span>Water demand</span><span class="v">{formatNumber(ev.totals.waterDemandLPerDay, ' L/day')}</span></div>
        <div class="row"><span>Water storage</span><span class="v">{formatNumber(ev.totals.waterStorageL, ' L')}</span></div>
      {/if}
      <div class="row"><span>Lead time</span><span class="v">{ev.totals.leadTimeWeeks} wk</span></div>
      <div class="row"><span>Est. shipping</span><span class="v">{formatCurrency(ev.totals.estShipping, ev.totals.currency)}</span></div>
      <div class="row total"><span>Grand total</span><span class="v">{formatCurrency(ev.totals.grandTotal, ev.totals.currency)}</span></div>

      {#if ev.warnings.length}
        <div class="cfg-warnings" role="status" aria-live="polite">
          {#each ev.warnings as w}
            <div class="cfg-warning" class:is-error={w.level === 'error'}>{w.message}</div>
          {/each}
        </div>
      {/if}
    {/if}

    <div class="cfg-canvas-toolbar" style="margin-top:14px;">
      <button class="cfg-btn is-primary" type="button" on:click={onSave} disabled={$readOnly}>Save configuration</button>
      <button class="cfg-btn" type="button" on:click={onShare} disabled={$config.modules.length === 0 || $readOnly}>Share link</button>
      <button class="cfg-btn is-purple" type="button" on:click={onDownloadPdf} disabled={$config.modules.length === 0}>Download spec sheet</button>
    </div>

    {#if shareUrl}
      <div class="cfg-link-row">
        <code>{shareUrl}</code>
        <button class="cfg-btn" type="button" on:click={() => navigator.clipboard?.writeText(shareUrl)}>Copy</button>
      </div>
    {/if}
</div>
