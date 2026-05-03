import type { Env } from '../env';
import { listTasks } from './crm';
import { buildExportBundle } from './admin-export';
import { sendRawEmail } from '../email/raw';
import { logEvent } from '../db/events';

// Cron entrypoints scheduled by wrangler.toml [triggers].crons.
//
// - Daily (08:00 UTC): aggregate overdue + due-today admin tasks and email
//   ops@ a digest. Skip the send if there's nothing to report so quiet days
//   don't pollute the inbox.
// - Weekly (Mon 06:00 UTC): rebuild the always-recent CSV bundle in R2 so
//   the admin "Export all" button has a fresh prebuilt snapshot to stream.

export async function runDailyTaskDigest(env: Env): Promise<{ sent: boolean; counts: { overdue: number; dueToday: number } }> {
  const now = Date.now();
  const startOfToday = new Date();
  startOfToday.setUTCHours(0, 0, 0, 0);
  const endOfToday = startOfToday.getTime() + 24 * 60 * 60 * 1000;

  const open = await listTasks(env, { status: 'open' });
  const overdue = open.filter((t) => t.dueAt != null && t.dueAt < startOfToday.getTime());
  const dueToday = open.filter((t) => t.dueAt != null && t.dueAt >= startOfToday.getTime() && t.dueAt < endOfToday);
  if (overdue.length === 0 && dueToday.length === 0) {
    return { sent: false, counts: { overdue: 0, dueToday: 0 } };
  }

  const lines: string[] = [];
  if (overdue.length) {
    lines.push(`<h3 style="margin:16px 0 4px;color:#b91c1c">Overdue (${overdue.length})</h3>`);
    lines.push('<ul>');
    for (const t of overdue) {
      lines.push(`<li><strong>${escapeHtml(t.title)}</strong> — due ${formatDate(t.dueAt!)}${t.customerId ? ' · ' + escapeHtml(t.customerId) : ''}</li>`);
    }
    lines.push('</ul>');
  }
  if (dueToday.length) {
    lines.push(`<h3 style="margin:16px 0 4px;color:#854d0e">Due today (${dueToday.length})</h3>`);
    lines.push('<ul>');
    for (const t of dueToday) {
      lines.push(`<li><strong>${escapeHtml(t.title)}</strong>${t.customerId ? ' · ' + escapeHtml(t.customerId) : ''}</li>`);
    }
    lines.push('</ul>');
  }

  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#0B0B0F">
    <h2 style="margin:0 0 8px">AXAL ops — daily task digest</h2>
    <p style="color:#6B7280;margin:0 0 16px">Generated ${new Date(now).toUTCString()}</p>
    ${lines.join('\n')}
    <p style="margin-top:24px"><a href="${env.APP_BASE_URL}/admin/#/tasks" style="color:#6B21A8">Open admin → Tasks</a></p>
  </body></html>`;

  const text = [
    `AXAL ops daily digest — ${new Date(now).toUTCString()}`,
    overdue.length ? `\nOVERDUE (${overdue.length}):\n` + overdue.map((t) => `  - ${t.title} — due ${formatDate(t.dueAt!)}${t.customerId ? ' · ' + t.customerId : ''}`).join('\n') : '',
    dueToday.length ? `\nDUE TODAY (${dueToday.length}):\n` + dueToday.map((t) => `  - ${t.title}${t.customerId ? ' · ' + t.customerId : ''}`).join('\n') : '',
    `\nOpen admin: ${env.APP_BASE_URL}/admin/#/tasks`,
  ].filter(Boolean).join('\n');

  await sendRawEmail(env, {
    to: env.EMAIL_REPLY_TO,
    subject: `AXAL ops — ${overdue.length} overdue, ${dueToday.length} due today`,
    html,
    text,
  });
  await logEvent(env.DB, {
    type: 'admin.task_digest_sent',
    actorKind: 'system',
    payload: { overdue: overdue.length, dueToday: dueToday.length },
  });
  return { sent: true, counts: { overdue: overdue.length, dueToday: dueToday.length } };
}

export async function runWeeklySnapshot(env: Env): Promise<{ key: string; sizeBytes: number }> {
  const result = await buildExportBundle(env);
  await logEvent(env.DB, {
    type: 'admin.weekly_snapshot',
    actorKind: 'system',
    payload: { key: result.key, sizeBytes: result.sizeBytes, tables: result.tables },
  });
  return { key: result.key, sizeBytes: result.sizeBytes };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}
function formatDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
