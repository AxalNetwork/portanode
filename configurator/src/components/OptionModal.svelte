<script>
  import { createEventDispatcher } from 'svelte';
  import { config, toggleOption, setModuleQty, removeModule } from '../stores/config.js';
  import { findModule } from '../lib/catalog.js';
  import { formatCurrency } from '../lib/catalog.js';
  export let catalog;
  export let moduleId;

  const dispatch = createEventDispatcher();
  $: mod = findModule(catalog, moduleId);
  $: entry = $config.modules.find((m) => m.moduleId === moduleId);
  $: selected = new Set(entry?.options || []);

  function groupBy(opts) {
    const groups = new Map();
    for (const o of opts) {
      const k = o.category || 'Options';
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(o);
    }
    return Array.from(groups, ([k, v]) => ({ category: k, items: v }));
  }

  $: groups = mod ? groupBy(mod.options) : [];

  function reasonFor(opt) {
    const reasons = [];
    for (const r of opt.requires || []) {
      if (!selected.has(r)) {
        const ro = mod.options.find((o) => o.id === r);
        if (ro) reasons.push(`Requires ${ro.name}`);
      }
    }
    for (const ex of opt.excludes || []) {
      if (selected.has(ex)) {
        const eo = mod.options.find((o) => o.id === ex);
        if (eo) reasons.push(`Replaces ${eo.name}`);
      }
    }
    return reasons.join(' · ');
  }

  function close() { dispatch('close'); }
  function onKey(e) { if (e.key === 'Escape') close(); }
</script>

<svelte:window on:keydown={onKey} />

{#if mod && entry}
  <div class="cfg-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="cfg-modal-title" on:click|self={close}>
    <div class="cfg-modal">
      <div class="cfg-modal-head">
        <div>
          <h3 id="cfg-modal-title">{mod.name}</h3>
          <small style="font-family:'JetBrains Mono',monospace;color:var(--axal-gray);font-size:11px">
            {mod.sku} · base {formatCurrency(mod.basePrice)} · {mod.dimensions.form} · {mod.weight.displayTons}
          </small>
        </div>
        <button type="button" class="cfg-btn" on:click={close} aria-label="Close options">Done</button>
      </div>
      <div class="cfg-modal-body">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
          <div class="qty cfg-stack-item" style="padding:6px 10px;">
            <span style="font-size:12px;font-family:'JetBrains Mono',monospace;">Quantity</span>
            <span class="qty">
              <button type="button" aria-label="Decrease quantity" on:click={() => setModuleQty(moduleId, (entry.qty || 1) - 1)}>−</button>
              <span style="min-width:20px;text-align:center;font-family:'JetBrains Mono',monospace;">{entry.qty}</span>
              <button type="button" aria-label="Increase quantity" on:click={() => setModuleQty(moduleId, (entry.qty || 1) + 1)}>+</button>
            </span>
          </div>
          <button type="button" class="cfg-btn" on:click={() => { removeModule(moduleId); close(); }}>Remove module</button>
        </div>

        {#each groups as g (g.category)}
          <div class="cfg-option-group">
            <h4>{g.category}</h4>
            {#each g.items as opt (opt.id)}
              {@const isOn = selected.has(opt.id)}
              {@const reason = reasonFor(opt)}
              <label class="cfg-option" class:selected={isOn}>
                <input
                  type="checkbox"
                  checked={isOn}
                  on:change={(e) => toggleOption(catalog, moduleId, opt.id, e.target.checked)}
                />
                <span style="flex:1;">
                  <span class="name">{opt.name}</span>
                  <span class="meta">
                    {#if opt.priceDelta}<span>{opt.priceDelta > 0 ? '+' : ''}{formatCurrency(opt.priceDelta)}</span>{:else}<span>included</span>{/if}
                    {#if opt.powerDelta}<span> · {opt.powerDelta > 0 ? '+' : ''}{opt.powerDelta} kW</span>{/if}
                    {#if opt.weightDelta}<span> · +{opt.weightDelta} kg</span>{/if}
                  </span>
                  {#if reason}<span class="reason">{reason}</span>{/if}
                </span>
              </label>
            {/each}
          </div>
        {/each}
      </div>
      <div class="cfg-modal-foot">
        <small style="color:var(--axal-gray);font-size:11px;font-family:'JetBrains Mono',monospace;">
          Changes apply live to spec ledger.
        </small>
        <button type="button" class="cfg-btn is-primary" on:click={close}>Done</button>
      </div>
    </div>
  </div>
{/if}
