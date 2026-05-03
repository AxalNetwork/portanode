#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const Ajv = require("ajv");

const root = path.resolve(__dirname, "..");
const dataDir = path.join(root, "_data");

function read(rel) {
  return JSON.parse(fs.readFileSync(path.join(dataDir, rel), "utf8"));
}

let failed = 0;
function fail(msg) {
  console.error("  ✗ " + msg);
  failed++;
}
function ok(msg) {
  console.log("  ✓ " + msg);
}

const schema = read("catalog.schema.json");
const catalog = read("catalog.json");
const stacks = read("stacks.json");
const promotions = read("promotions.json");

console.log("Validating _data/catalog.json against catalog.schema.json …");
const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(schema);
if (validate(catalog)) {
  ok("catalog.json matches schema");
} else {
  fail("catalog.json schema errors:");
  for (const e of validate.errors) {
    console.error("    " + (e.instancePath || "/") + " " + e.message);
  }
}

console.log("Cross-checking ids, requires/excludes, regions, interconnects …");
const moduleIds = new Set(catalog.modules.map((m) => m.id));
const regionIds = new Set(catalog.regions.map((r) => r.id));

for (const m of catalog.modules) {
  for (const r of m.regions) {
    if (!regionIds.has(r)) fail(`module ${m.id}: unknown region "${r}"`);
  }
  for (const ic of m.interconnects) {
    if (!moduleIds.has(ic.targetModuleId)) {
      fail(`module ${m.id}: interconnect targets unknown module "${ic.targetModuleId}"`);
    }
    if (ic.targetModuleId === m.id) {
      fail(`module ${m.id}: cannot interconnect to itself`);
    }
  }
  const optIds = new Set();
  const optsByCategory = new Map();
  for (const o of m.options) {
    if (optIds.has(o.id)) fail(`module ${m.id}: duplicate option id "${o.id}"`);
    optIds.add(o.id);
    if (!optsByCategory.has(o.category)) optsByCategory.set(o.category, []);
    optsByCategory.get(o.category).push(o);
  }
  for (const o of m.options) {
    for (const r of o.requires || []) {
      if (!optIds.has(r)) {
        fail(`module ${m.id}, option ${o.id}: requires unknown option "${r}"`);
      }
    }
    for (const e of o.excludes || []) {
      if (!optIds.has(e)) {
        fail(`module ${m.id}, option ${o.id}: excludes unknown option "${e}"`);
      }
    }
    // self-reference
    if ((o.requires || []).includes(o.id)) {
      fail(`module ${m.id}, option ${o.id}: requires itself`);
    }
    if ((o.excludes || []).includes(o.id)) {
      fail(`module ${m.id}, option ${o.id}: excludes itself`);
    }
  }
  // exactly one default per category that has any default
  for (const [cat, opts] of optsByCategory) {
    const defaults = opts.filter((o) => o.default);
    if (defaults.length > 1) {
      fail(`module ${m.id}: category "${cat}" has ${defaults.length} defaults`);
    }
  }
}
if (failed === 0) ok("catalog cross-references resolve");

console.log("Validating _data/stacks.json against catalog …");
const stackIds = new Set();
for (const s of stacks.stacks) {
  if (!s.id || !s.name || !Array.isArray(s.modules)) {
    fail(`stack missing id/name/modules: ${JSON.stringify(s)}`);
    continue;
  }
  if (stackIds.has(s.id)) fail(`duplicate stack id "${s.id}"`);
  stackIds.add(s.id);

  for (const entry of s.modules) {
    const mod = catalog.modules.find((mm) => mm.id === entry.moduleId);
    if (!mod) {
      fail(`stack ${s.id}: unknown moduleId "${entry.moduleId}"`);
      continue;
    }
    if (!Number.isInteger(entry.qty) || entry.qty < 1) {
      fail(`stack ${s.id}: module ${entry.moduleId} has invalid qty`);
    }
    const optIds = new Set(mod.options.map((o) => o.id));
    const chosen = new Set(entry.options || []);
    for (const oid of chosen) {
      if (!optIds.has(oid)) {
        fail(`stack ${s.id}: module ${entry.moduleId} picks unknown option "${oid}"`);
      }
    }
    // requires/excludes within the chosen set
    for (const oid of chosen) {
      const opt = mod.options.find((o) => o.id === oid);
      if (!opt) continue;
      for (const r of opt.requires || []) {
        if (!chosen.has(r)) {
          fail(`stack ${s.id}: module ${entry.moduleId} option "${oid}" requires "${r}"`);
        }
      }
      for (const x of opt.excludes || []) {
        if (chosen.has(x)) {
          fail(`stack ${s.id}: module ${entry.moduleId} option "${oid}" excludes "${x}" (both selected)`);
        }
      }
    }
  }
}
if (stacks.stacks.length < 6 || stacks.stacks.length > 10) {
  fail(`stacks.json must have 6–10 stacks (found ${stacks.stacks.length})`);
}
if (failed === 0) ok(`${stacks.stacks.length} stacks validated`);

console.log("Validating _data/promotions.json shape …");
if (!Array.isArray(promotions.promotions)) {
  fail("promotions.json must have a promotions[] array");
} else {
  ok(`promotions.json ok (${promotions.promotions.length} entries)`);
}

if (failed > 0) {
  console.error(`\nFAILED: ${failed} catalog validation error(s).`);
  process.exit(1);
}
console.log("\nOK: catalog, stacks, and promotions all valid.");
