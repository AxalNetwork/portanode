<script>
  import { onMount } from 'svelte';
  import { catalog as catalogStore, config, evaluation, addModule, loadFromConfig, loadStack, readOnly } from './stores/config.js';
  import { loadCatalog } from './lib/catalog.js';
  import { saveConfig, loadConfig, loadConfigRecord, isOwner, generateId, buildShareUrl, readUrlParams } from './lib/persistence.js';
  import ModulePicker from './components/ModulePicker.svelte';
  import Canvas3D from './components/Canvas3D.svelte';
  import OptionModal from './components/OptionModal.svelte';
  import SpecLedger from './components/SpecLedger.svelte';
  import StackList from './components/StackList.svelte';

  let catalog = null;
  let stacksData = null;
  let activeModuleId = null;
  let activeTab = 'canvas';
  let savedId = null;
  let shareUrl = '';
  let toast = '';
  let toastTimer;

  function flash(msg) {
    toast = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = ''), 2400);
  }

  onMount(async () => {
    try {
      catalog = await loadCatalog();
      catalogStore.set(catalog);
    } catch (e) {
      console.error('Failed to load catalog', e);
      return;
    }
    try {
      const r = await fetch('/assets/configurator/stacks.json');
      if (r.ok) stacksData = await r.json();
    } catch (e) {}

    const params = readUrlParams();
    if (params.configId) {
      const record = loadConfigRecord(params.configId);
      if (record) {
        loadFromConfig({ ...record.config, id: params.configId });
        savedId = params.configId;
        if (!isOwner(record)) {
          readOnly.set(true);
          flash('Shared configuration — read only');
        } else {
          flash('Configuration loaded');
        }
      } else {
        // Unknown id locally — treat as a shared link (read-only stub until
        // the worker round-trips the config).
        readOnly.set(true);
        flash('Shared configuration — read only');
      }
    } else if (params.stackId) {
      loadStack(catalog, stacksData, params.stackId);
    } else if (params.moduleId) {
      addModule(catalog, params.moduleId);
    }
  });

  async function claimConfig() {
    // Generate a fresh id under this browser's owner token, drop the read-only flag.
    const newId = await saveConfig({ ...$config }, null);
    savedId = newId;
    config.update((c) => ({ ...c, id: newId }));
    readOnly.set(false);
    history.replaceState(null, '', `?c=${encodeURIComponent(newId)}`);
    shareUrl = '';
    flash('Claimed — you can now edit');
  }

  function openOptionsFor(id) {
    activeModuleId = id;
  }

  async function onSave() {
    if ($readOnly) { flash('Read-only — claim first to save'); return; }
    const id = await saveConfig({ ...$config }, savedId);
    savedId = id;
    config.update((c) => ({ ...c, id }));
    shareUrl = buildShareUrl(id);
    history.replaceState(null, '', `?c=${encodeURIComponent(id)}`);
    flash(`Saved as ${id}`);
  }
  async function onShare() {
    if (!savedId) await onSave();
    else shareUrl = buildShareUrl(savedId);
    try { await navigator.clipboard?.writeText(shareUrl); flash('Share link copied'); }
    catch (e) { flash('Share link ready'); }
  }
  function onDownloadPdf() {
    const id = savedId || generateId('q_');
    // Stub: hits a worker route that ships in phase 8
    flash('Generating spec sheet…');
    fetch(`/api/quotes/${id}/pdf`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify($config) })
      .then((r) => r.ok ? r.blob() : Promise.reject(r.status))
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank', 'noopener');
      })
      .catch(() => flash('Spec sheet generation queued (offline)'));
  }
</script>

<div class="cfg-tabs" role="tablist" aria-label="Configurator views">
  <button role="tab" aria-selected={activeTab === 'modules'} on:click={() => (activeTab = 'modules')}>Modules</button>
  <button role="tab" aria-selected={activeTab === 'canvas'} on:click={() => (activeTab = 'canvas')}>Canvas</button>
  <button role="tab" aria-selected={activeTab === 'specs'} on:click={() => (activeTab = 'specs')}>Specs</button>
</div>

{#if !catalog}
  <div class="cfg-empty" style="padding:80px 20px;">Loading catalog…</div>
{:else}
  {#if $readOnly}
    <div class="cfg-readonly-banner" role="status">
      <span><strong>Read-only.</strong> You're viewing a shared configuration.</span>
      <button type="button" class="cfg-btn is-primary" on:click={claimConfig}>Claim &amp; edit</button>
    </div>
  {/if}
  <div class="cfg-shell" class:is-readonly={$readOnly}>
    <div class="cfg-pane" class:is-active={activeTab === 'modules'} style="grid-column: 1;">
      <ModulePicker {catalog} />
    </div>

    <div class="cfg-pane" class:is-active={activeTab === 'canvas'} style="grid-column: 2;">
      <h2>Stack Preview</h2>
      <Canvas3D {catalog} onSelectModule={openOptionsFor} />
      <div style="margin-top:12px;">
        <StackList {catalog} evaluation={$evaluation} onOpen={openOptionsFor} />
      </div>
    </div>

    <div class="cfg-pane" class:is-active={activeTab === 'specs'} style="grid-column: 3;">
      <SpecLedger {catalog} {onSave} {onShare} {onDownloadPdf} {savedId} {shareUrl} />
    </div>
  </div>
{/if}

{#if activeModuleId}
  <OptionModal {catalog} moduleId={activeModuleId} on:close={() => (activeModuleId = null)} />
{/if}

{#if toast}
  <div class="cfg-toast" role="status" aria-live="polite">{toast}</div>
{/if}
