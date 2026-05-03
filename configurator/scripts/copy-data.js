// Copies _data/catalog.json + stacks.json into the build output so the
// Svelte app can fetch them at runtime without going through Jekyll Liquid,
// then enforces an explicit bundle-size budget for the initial JS payload.
import { copyFileSync, mkdirSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const out = resolve(root, 'assets', 'configurator');
mkdirSync(out, { recursive: true });

for (const name of ['catalog.json', 'stacks.json']) {
  const src = resolve(root, '_data', name);
  const dst = resolve(out, name);
  copyFileSync(src, dst);
  console.log(`[copy-data] ${src} -> ${dst}`);
}

// Bundle budgets (bytes, minified, pre-gzip).
// bundle.js excludes the lazy three.js chunk by design.
const BUDGETS = {
  'bundle.js': 80 * 1024,    // initial JS payload
  'bundle.css': 20 * 1024
};

let failed = false;
for (const [file, max] of Object.entries(BUDGETS)) {
  const path = resolve(out, file);
  const size = statSync(path).size;
  const ok = size <= max;
  console.log(`[budget] ${file} ${size} / ${max} bytes ${ok ? 'OK' : 'OVER BUDGET'}`);
  if (!ok) failed = true;
}
if (failed) {
  console.error('[budget] Bundle budget exceeded. Inspect imports or split further.');
  process.exit(1);
}
