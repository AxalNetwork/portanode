// Bundle budget enforcement for the customer-portal app. Budgets are tuned
// to the configurator's pre-three.js initial payload so the portal stays
// fast on the same paint budget.
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { statSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '..', '..', 'assets', 'account');

const BUDGETS = {
  'bundle.js': 90 * 1024,
  'bundle.css': 20 * 1024,
};

let failed = false;
for (const [file, max] of Object.entries(BUDGETS)) {
  const size = statSync(resolve(out, file)).size;
  const ok = size <= max;
  console.log(`[budget] ${file} ${size} / ${max} bytes ${ok ? 'OK' : 'OVER BUDGET'}`);
  if (!ok) failed = true;
}
if (failed) {
  console.error('[budget] Account bundle exceeded budget.');
  process.exit(1);
}
