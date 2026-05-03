#!/usr/bin/env node
/**
 * Compile MJML email templates to inline-styled HTML.
 *
 * Reads `workers/src/email/templates/*.mjml` and writes the corresponding
 * `<name>.html` into `workers/src/email/compiled/`. The runtime `templates.ts`
 * has hand-tuned HTML fallbacks identical in shape so the worker bundle
 * stays dependency-free; this build step is a deploy-time check that the
 * MJML sources still compile, and produces production-ready HTML for any
 * external preview / QA tooling.
 */
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename, extname } from 'node:path';
import mjml2html from 'mjml';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, '..', 'src', 'email', 'templates');
const outDir = join(here, '..', 'src', 'email', 'compiled');

await mkdir(outDir, { recursive: true });
const files = (await readdir(srcDir)).filter((f) => extname(f) === '.mjml');

let failed = 0;
for (const f of files) {
  const src = await readFile(join(srcDir, f), 'utf8');
  const { html, errors } = mjml2html(src, { validationLevel: 'soft', minify: true });
  if (errors && errors.length) {
    for (const e of errors) console.error(`[${f}] ${e.formattedMessage ?? e.message}`);
    failed += 1;
  }
  const name = basename(f, '.mjml');
  await writeFile(join(outDir, `${name}.html`), html, 'utf8');
  console.log(`compiled ${f} -> compiled/${name}.html`);
}
if (failed > 0) {
  console.error(`${failed} template(s) failed to compile`);
  process.exit(1);
}
