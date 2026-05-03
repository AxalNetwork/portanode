// Pure constraint engine. Given a catalog and a config, returns:
// { totals, warnings, lineItems, autoEnabled }
//
// config = { modules: [{ moduleId, qty, options: [optionId,...] }], regionId }

import { findModule, findOption } from './catalog.js';

export function evaluate(catalog, config) {
  const warnings = [];
  const lineItems = [];
  let subtotal = 0;
  let powerDraw = 0;
  let powerGen = 0;
  let weightKg = 0;
  let footprintM2 = 0;
  let leadTimeWeeks = 0;
  let waterStorageL = 0;
  let waterDemandLPerDay = 0;
  const presentModuleIds = new Set(config.modules.map((m) => m.moduleId));

  // Required interconnect check
  for (const entry of config.modules) {
    const mod = findModule(catalog, entry.moduleId);
    if (!mod) continue;
    for (const ic of mod.interconnects || []) {
      if (ic.required && !presentModuleIds.has(ic.targetModuleId)) {
        warnings.push({
          level: 'error',
          moduleId: mod.id,
          message: `${mod.name} requires a ${ic.targetModuleId.toUpperCase()} module (${ic.type})`
        });
      }
    }
  }

  for (const entry of config.modules) {
    const mod = findModule(catalog, entry.moduleId);
    if (!mod) continue;
    const qty = Math.max(1, entry.qty || 1);

    let unitPrice = mod.basePrice;
    let unitWeight = mod.weight?.kg || 0;
    let unitDraw = mod.power?.drawKw || 0;
    let unitGen = mod.power?.generationKw || 0;
    const optionDetails = [];

    // Option-level constraints
    const selectedSet = new Set(entry.options || []);
    for (const optId of entry.options || []) {
      const opt = findOption(mod, optId);
      if (!opt) continue;
      // requires
      for (const req of opt.requires || []) {
        const reqOpt = findOption(mod, req);
        if (reqOpt && !selectedSet.has(req)) {
          warnings.push({
            level: 'error',
            moduleId: mod.id,
            message: `${mod.name}: "${opt.name}" requires "${reqOpt.name}"`
          });
        }
      }
      // excludes
      for (const ex of opt.excludes || []) {
        if (selectedSet.has(ex)) {
          const exOpt = findOption(mod, ex);
          warnings.push({
            level: 'error',
            moduleId: mod.id,
            message: `${mod.name}: "${opt.name}" excludes "${exOpt ? exOpt.name : ex}"`
          });
        }
      }
      unitPrice += opt.priceDelta || 0;
      unitWeight += opt.weightDelta || 0;
      unitDraw += opt.powerDelta || 0;
      optionDetails.push({ id: opt.id, name: opt.name, priceDelta: opt.priceDelta || 0 });
    }

    // Water capacity / demand. Flow holds storage; consumers draw from it.
    if (mod.id === 'flow') {
      // Storage option ids encode capacity in their name (storage-4k -> 4000 L)
      for (const optId of entry.options || []) {
        if (optId === 'storage-4k') waterStorageL += 4000 * qty;
        else if (optId === 'storage-8k') waterStorageL += 8000 * qty;
      }
      // AWG adds production
      if ((entry.options || []).includes('awg-200')) {
        waterDemandLPerDay -= 200 * qty; // negative demand = generation
      }
    }
    // Per-module daily water demand heuristic (litres / day per unit)
    const WATER_DEMAND = {
      grow: 1200,   // hydroponics + HVAC condensate makeup
      care: 600,    // exam rooms, lab, sterilisation
      shell: 320,   // habitation per 20ft module
      cycle: 200,   // process water
      learn: 90,    // classroom potable
      core: 20,
      volt: 0,
      flow: 0
    };
    waterDemandLPerDay += (WATER_DEMAND[mod.id] || 0) * qty;

    // Region availability
    if (config.regionId && Array.isArray(mod.regions) && !mod.regions.includes(config.regionId)) {
      warnings.push({
        level: 'error',
        moduleId: mod.id,
        message: `${mod.name} not available in selected region`
      });
    }

    const lineSubtotal = unitPrice * qty;
    subtotal += lineSubtotal;
    weightKg += unitWeight * qty;
    powerDraw += unitDraw * qty;
    powerGen += unitGen * qty;
    leadTimeWeeks = Math.max(leadTimeWeeks, mod.leadTimeWeeks || 0);
    if (mod.dimensions) {
      const area = (mod.dimensions.lengthFt || 0) * (mod.dimensions.widthFt || 0) * 0.0929;
      footprintM2 += area * qty;
    }

    lineItems.push({
      moduleId: mod.id,
      name: mod.name,
      sku: mod.sku,
      qty,
      unitPrice,
      lineSubtotal,
      options: optionDetails
    });
  }

  // Region-aware adders
  let leadTimeAdder = 0;
  let freightTier = 1;
  let estShipping = 0;
  if (config.regionId) {
    const region = catalog.regions.find((r) => r.id === config.regionId);
    if (region) {
      leadTimeAdder = region.leadTimeAdderWeeks || 0;
      freightTier = region.freightTier || 1;
      // very rough freight estimate: $2.20/kg for tier 1, *1.5 tier 2, *2.2 tier 3
      const tierMult = freightTier === 1 ? 1 : freightTier === 2 ? 1.5 : 2.2;
      estShipping = Math.round((weightKg * 2.2 * tierMult) / 100) * 100;
    }
  }

  // Power balance
  if (powerGen > 0 && powerDraw > powerGen * 1.4) {
    warnings.push({
      level: 'warn',
      message: `Power draw (${powerDraw.toFixed(1)} kW) significantly exceeds Volt generation (${powerGen.toFixed(1)} kW). Consider adding Volt capacity or larger PV/battery.`
    });
  }

  // Water capacity vs Flow storage. ~3 days of consumer demand should fit in Flow buffer.
  const hasConsumer = config.modules.some((m) => ['grow', 'care', 'shell', 'cycle', 'learn'].includes(m.moduleId));
  if (hasConsumer && waterStorageL <= 0) {
    warnings.push({
      level: 'error',
      message: 'Water-using modules require a Flow module with at least one storage tank.'
    });
  } else if (waterDemandLPerDay > 0 && waterStorageL > 0) {
    const bufferDays = waterStorageL / waterDemandLPerDay;
    if (bufferDays < 1) {
      warnings.push({
        level: 'error',
        message: `Flow storage (${waterStorageL.toLocaleString()} L) provides under 24 h buffer at estimated ${Math.round(waterDemandLPerDay).toLocaleString()} L/day demand. Add more Flow modules, upgrade to 8,000 L storage, or add atmospheric water.`
      });
    } else if (bufferDays < 3) {
      warnings.push({
        level: 'warn',
        message: `Flow storage gives ~${bufferDays.toFixed(1)} days of water buffer at ${Math.round(waterDemandLPerDay).toLocaleString()} L/day. Recommended ≥3 days.`
      });
    }
  }

  // Footprint vs site size
  if (config.siteSizeM2 && footprintM2 > config.siteSizeM2) {
    warnings.push({
      level: 'warn',
      message: `Footprint (${footprintM2.toFixed(0)} m²) exceeds site size (${config.siteSizeM2} m²)`
    });
  }

  const grandTotal = subtotal + estShipping;

  return {
    lineItems,
    warnings,
    totals: {
      subtotal,
      estShipping,
      grandTotal,
      powerDraw,
      powerGen,
      weightKg,
      footprintM2,
      waterStorageL,
      waterDemandLPerDay,
      leadTimeWeeks: leadTimeWeeks + leadTimeAdder,
      currency: catalog.currency || 'USD'
    }
  };
}

// Auto-add a module's required interconnect targets and default options.
export function ensureModuleDefaults(catalog, moduleId, existingOpts) {
  const mod = findModule(catalog, moduleId);
  if (!mod) return [];
  if (existingOpts && existingOpts.length) return existingOpts;
  return mod.options.filter((o) => o.default).map((o) => o.id);
}

// When toggling an option, auto-deselect excluded options and add required ones.
export function applyOptionToggle(module, currentOptions, optionId, enable) {
  const set = new Set(currentOptions);
  const opt = findOption(module, optionId);
  if (!opt) return [...set];

  if (enable) {
    set.add(optionId);
    for (const ex of opt.excludes || []) set.delete(ex);
    for (const req of opt.requires || []) {
      const reqOpt = findOption(module, req);
      if (reqOpt) set.add(req);
    }
  } else {
    set.delete(optionId);
    // If a category default exists and we removed all in that category, re-add the default.
    const cat = opt.category;
    if (cat) {
      const inCategory = module.options.filter((o) => o.category === cat);
      const anySelected = inCategory.some((o) => set.has(o.id));
      if (!anySelected) {
        const def = inCategory.find((o) => o.default);
        if (def) set.add(def.id);
      }
    }
    // Cascade: drop options that required this one
    let changed = true;
    while (changed) {
      changed = false;
      for (const o of module.options) {
        if (set.has(o.id) && (o.requires || []).some((r) => !set.has(r))) {
          set.delete(o.id);
          changed = true;
        }
      }
    }
  }
  return Array.from(set);
}
