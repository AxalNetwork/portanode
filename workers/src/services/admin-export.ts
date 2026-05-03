import type { Env } from '../env';
import { buildZip } from '../lib/zip';

// CRM data export: produce a ZIP archive with one CSV per table and persist
// it to R2 (`admin-exports/{date}.zip` + `admin-exports/latest.zip`). The
// weekly cron rebuilds `latest.zip`; ops can also trigger a fresh build via
// `POST /admin/exports/run`. Workers don't ship a streaming compressor, so
// we use a tiny in-house STORED-only zip writer (see `lib/zip.ts`).

const TABLES = [
  { name: 'customers', columns: ['id', 'email', 'name', 'company', 'phone', 'region', 'created_at', 'last_login_at'] },
  { name: 'leads', columns: ['id', 'kind', 'email', 'name', 'company', 'region', 'status', 'message', 'created_at'] },
  { name: 'quotes', columns: ['id', 'customer_id', 'status', 'contact_email', 'contact_company', 'region', 'currency', 'total_cents', 'deposit_cents', 'created_at', 'expires_at'] },
  { name: 'orders', columns: ['id', 'customer_id', 'quote_id', 'status', 'region', 'currency', 'total_cents', 'deposit_paid_cents', 'balance_paid_cents', 'refunded_cents', 'created_at', 'shipped_at', 'delivered_at'] },
  { name: 'invoices', columns: ['id', 'order_id', 'kind', 'amount_cents', 'currency', 'stripe_invoice_id', 'issued_at', 'paid_at'] },
  { name: 'refunds', columns: ['id', 'order_id', 'amount_cents', 'currency', 'reason', 'policy_band', 'status', 'created_at'] },
  { name: 'customer_notes', columns: ['id', 'customer_id', 'author_id', 'body', 'created_at'] },
  { name: 'admin_tasks', columns: ['id', 'title', 'description', 'customer_id', 'order_id', 'due_at', 'completed_at', 'created_at'] },
];

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

async function tableCsv(env: Env, name: string, columns: string[]): Promise<string> {
  const sql = `SELECT ${columns.join(', ')} FROM ${name} ORDER BY rowid`;
  const { results } = await env.DB.prepare(sql).all<Record<string, unknown>>();
  const lines: string[] = [columns.join(',')];
  for (const r of results ?? []) {
    lines.push(columns.map((c) => csvEscape(r[c])).join(','));
  }
  return lines.join('\n') + '\n';
}

export async function buildExportBundle(
  env: Env,
): Promise<{ key: string; sizeBytes: number; takenAt: number; tables: string[] }> {
  const now = Date.now();
  const entries = [];
  const tableNames: string[] = [];
  for (const t of TABLES) {
    const csv = await tableCsv(env, t.name, t.columns);
    entries.push({ name: `${t.name}.csv`, body: csv });
    tableNames.push(t.name);
  }
  // README inside the archive describes what each CSV contains, so a
  // recipient who unzips without context still has provenance.
  const readme = [
    `AXAL admin export — ${new Date(now).toISOString()}`,
    '',
    'One CSV per table. All money columns are integer cents in canonical USD',
    'except where a `currency` column is present (those are presentment',
    'amounts in that currency).',
    '',
    ...tableNames.map((n) => `- ${n}.csv`),
    '',
  ].join('\n');
  entries.push({ name: 'README.txt', body: readme });

  const zip = buildZip(entries);
  const dateKey = new Date(now).toISOString().slice(0, 10);
  const key = `admin-exports/${dateKey}.zip`;
  await env.ASSETS.put(key, zip, {
    httpMetadata: { contentType: 'application/zip' },
    customMetadata: { takenAt: String(now), tables: tableNames.join(',') },
  });
  await env.ASSETS.put('admin-exports/latest.zip', zip, {
    httpMetadata: { contentType: 'application/zip' },
    customMetadata: { takenAt: String(now) },
  });
  return { key, sizeBytes: zip.byteLength, takenAt: now, tables: tableNames };
}

export async function getExportObject(env: Env, key: string): Promise<R2ObjectBody | null> {
  // Allow both the new .zip exports and any legacy .csv objects still in R2
  // so old links don't 404 immediately after this rollout.
  if (!/^admin-exports\/[\w.-]+\.(zip|csv)$/.test(key)) return null;
  return env.ASSETS.get(key);
}

export async function listExports(
  env: Env,
): Promise<{ key: string; size: number; uploaded: string }[]> {
  const list = await env.ASSETS.list({ prefix: 'admin-exports/' });
  return list.objects.map((o) => ({
    key: o.key,
    size: o.size,
    uploaded: o.uploaded.toISOString(),
  }));
}
