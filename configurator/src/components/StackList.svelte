<script>
  import { config, removeModule, setModuleQty } from '../stores/config.js';
  import { findModule } from '../lib/catalog.js';
  export let catalog;
  export let evaluation;
  export let onOpen = () => {};

  $: errorByModule = (() => {
    const m = new Map();
    if (!evaluation) return m;
    for (const w of evaluation.warnings) {
      if (w.level === 'error' && w.moduleId) {
        if (!m.has(w.moduleId)) m.set(w.moduleId, []);
        m.get(w.moduleId).push(w.message);
      }
    }
    return m;
  })();
</script>

<div class="cfg-stack" aria-label="Selected modules">
  {#each $config.modules as entry (entry.moduleId)}
    {@const mod = findModule(catalog, entry.moduleId)}
    {#if mod}
      <div class="cfg-stack-item" class:is-invalid={errorByModule.has(entry.moduleId)}>
        <div>
          <div style="font-weight:600;font-size:13px;">{mod.name}</div>
          <button type="button" class="link" on:click={() => onOpen(entry.moduleId)}>
            {entry.options.length} options · edit
          </button>
        </div>
        <div class="qty">
          <button type="button" aria-label="Decrease" on:click={() => setModuleQty(entry.moduleId, (entry.qty || 1) - 1)}>−</button>
          <span style="font-family:'JetBrains Mono',monospace;font-size:12px;">{entry.qty}</span>
          <button type="button" aria-label="Increase" on:click={() => setModuleQty(entry.moduleId, (entry.qty || 1) + 1)}>+</button>
          <button type="button" aria-label="Remove" style="margin-left:6px" on:click={() => removeModule(entry.moduleId)}>×</button>
        </div>
      </div>
    {/if}
  {/each}
  {#if $config.modules.length === 0}
    <div class="cfg-empty">No modules selected. Add one from the left rail.</div>
  {/if}
</div>
