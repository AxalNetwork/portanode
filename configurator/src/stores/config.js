import { writable, derived } from 'svelte/store';
import { evaluate, ensureModuleDefaults, applyOptionToggle } from '../lib/constraints.js';
import { findModule } from '../lib/catalog.js';

export const catalog = writable(null);

// Read-only mode for shared configurations until "claimed".
export const readOnly = writable(false);

let _readOnly = false;
readOnly.subscribe((v) => { _readOnly = v; });
export function isReadOnly() { return _readOnly; }

const initial = {
  id: null,
  modules: [], // [{ moduleId, qty, options: [] }]
  regionId: 'na',
  siteSizeM2: null
};

export const config = writable(initial);

export const evaluation = derived([catalog, config], ([$catalog, $config]) => {
  if (!$catalog) return null;
  return evaluate($catalog, $config);
});

export function resetConfig() { config.set({ ...initial, modules: [] }); }

export function setRegion(regionId) {
  if (_readOnly) return;
  config.update((c) => ({ ...c, regionId }));
}
export function setSiteSize(m2) {
  if (_readOnly) return;
  config.update((c) => ({ ...c, siteSizeM2: m2 ? Number(m2) : null }));
}

export function addModule(catalogValue, moduleId) {
  if (_readOnly) return;
  const mod = findModule(catalogValue, moduleId);
  if (!mod) return;
  config.update((c) => {
    const next = { ...c, modules: c.modules.slice() };
    const existing = next.modules.find((m) => m.moduleId === moduleId);
    if (existing) {
      existing.qty = (existing.qty || 1) + 1;
    } else {
      next.modules.push({
        moduleId,
        qty: 1,
        options: ensureModuleDefaults(catalogValue, moduleId, [])
      });
    }
    // auto-add required interconnect targets (e.g., volt for core)
    for (const ic of mod.interconnects || []) {
      if (ic.required && !next.modules.some((m) => m.moduleId === ic.targetModuleId)) {
        const targetMod = findModule(catalogValue, ic.targetModuleId);
        if (targetMod) {
          next.modules.push({
            moduleId: ic.targetModuleId,
            qty: 1,
            options: ensureModuleDefaults(catalogValue, ic.targetModuleId, [])
          });
        }
      }
    }
    return next;
  });
}

export function removeModule(moduleId) {
  if (_readOnly) return;
  config.update((c) => ({ ...c, modules: c.modules.filter((m) => m.moduleId !== moduleId) }));
}

export function setModuleQty(moduleId, qty) {
  if (_readOnly) return;
  config.update((c) => ({
    ...c,
    modules: c.modules.map((m) =>
      m.moduleId === moduleId ? { ...m, qty: Math.max(1, qty | 0) } : m
    )
  }));
}

export function toggleOption(catalogValue, moduleId, optionId, enable) {
  if (_readOnly) return;
  const mod = findModule(catalogValue, moduleId);
  if (!mod) return;
  config.update((c) => ({
    ...c,
    modules: c.modules.map((m) => {
      if (m.moduleId !== moduleId) return m;
      return { ...m, options: applyOptionToggle(mod, m.options || [], optionId, enable) };
    })
  }));
}

export function loadFromConfig(saved) {
  if (!saved) return;
  config.set({
    id: saved.id || null,
    modules: Array.isArray(saved.modules) ? saved.modules : [],
    regionId: saved.regionId || 'na',
    siteSizeM2: saved.siteSizeM2 || null
  });
}

export function loadStack(catalogValue, stacksData, stackId) {
  if (!stacksData) return;
  const stack = stacksData.stacks.find((s) => s.id === stackId);
  if (!stack) return;
  const modules = stack.modules.map((m) => ({
    moduleId: m.moduleId,
    qty: m.qty || 1,
    options: m.options && m.options.length
      ? m.options
      : ensureModuleDefaults(catalogValue, m.moduleId, [])
  }));
  config.update((c) => ({ ...c, modules }));
}
