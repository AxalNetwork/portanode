import { z } from 'zod';
import type { Env } from '../env';
import { Errors } from '../lib/errors';
import { newShortId } from '../lib/ids';
import { logEvent } from '../db/events';

// ---------------------------------------------------------------------------
// Customer notes (admin-only, free-text, append-only timeline)
// ---------------------------------------------------------------------------

export const CustomerNoteInput = z.object({
  body: z.string().min(1).max(8000),
});

export async function listCustomerNotes(env: Env, customerId: string) {
  const { results } = await env.DB.prepare(
    `SELECT id, customer_id, author_id, body, created_at
       FROM customer_notes
      WHERE customer_id = ?
      ORDER BY created_at DESC`,
  )
    .bind(customerId)
    .all();
  return results ?? [];
}

export async function addCustomerNote(
  env: Env,
  customerId: string,
  body: string,
  authorId: string,
  reqMeta: { requestId: string; ip: string },
) {
  const id = `n_${newShortId()}`;
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO customer_notes (id, customer_id, author_id, body, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(id, customerId, authorId, body, now)
    .run();
  await logEvent(env.DB, {
    type: 'customer.note_added',
    actorKind: 'admin',
    actorId: authorId,
    subjectKind: 'customer',
    subjectId: customerId,
    requestId: reqMeta.requestId,
    ip: reqMeta.ip,
  });
  return { id, customerId, authorId, body, createdAt: now };
}

export async function deleteCustomerNote(env: Env, noteId: string) {
  await env.DB.prepare(`DELETE FROM customer_notes WHERE id = ?`).bind(noteId).run();
}

// ---------------------------------------------------------------------------
// Admin tasks
// ---------------------------------------------------------------------------

export const TaskInput = z.object({
  title: z.string().min(1).max(280),
  description: z.string().max(4000).optional().nullable(),
  customerId: z.string().max(40).optional().nullable(),
  orderId: z.string().max(40).optional().nullable(),
  dueAt: z.number().int().positive().optional().nullable(),
});

export const TaskPatch = z.object({
  title: z.string().min(1).max(280).optional(),
  description: z.string().max(4000).optional().nullable(),
  dueAt: z.number().int().positive().optional().nullable(),
  completed: z.boolean().optional(),
});

export interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  customerId: string | null;
  orderId: string | null;
  dueAt: number | null;
  completedAt: number | null;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
}

function hydrateTask(r: Record<string, unknown>): TaskRow {
  return {
    id: String(r.id),
    title: String(r.title),
    description: (r.description as string) ?? null,
    customerId: (r.customer_id as string) ?? null,
    orderId: (r.order_id as string) ?? null,
    dueAt: r.due_at ? Number(r.due_at) : null,
    completedAt: r.completed_at ? Number(r.completed_at) : null,
    createdBy: (r.created_by as string) ?? null,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

export async function listTasks(
  env: Env,
  opts: { status?: 'open' | 'completed' | 'overdue' | 'all'; customerId?: string; orderId?: string } = {},
): Promise<TaskRow[]> {
  const where: string[] = [];
  const args: unknown[] = [];
  if (opts.customerId) { where.push('customer_id = ?'); args.push(opts.customerId); }
  if (opts.orderId) { where.push('order_id = ?'); args.push(opts.orderId); }
  const status = opts.status ?? 'open';
  if (status === 'open') where.push('completed_at IS NULL');
  else if (status === 'completed') where.push('completed_at IS NOT NULL');
  else if (status === 'overdue') {
    where.push('completed_at IS NULL AND due_at IS NOT NULL AND due_at < ?');
    args.push(Date.now());
  }
  const sql = `SELECT * FROM admin_tasks ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY (completed_at IS NULL) DESC,
                        (due_at IS NULL) ASC,
                        due_at ASC,
                        created_at DESC
               LIMIT 500`;
  const { results } = await env.DB.prepare(sql).bind(...args).all<Record<string, unknown>>();
  return (results ?? []).map(hydrateTask);
}

export async function createTask(
  env: Env,
  input: z.infer<typeof TaskInput>,
  createdBy: string,
  reqMeta: { requestId: string; ip: string },
): Promise<TaskRow> {
  const id = `t_${newShortId()}`;
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO admin_tasks (id, title, description, customer_id, order_id, due_at, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      input.title,
      input.description ?? null,
      input.customerId ?? null,
      input.orderId ?? null,
      input.dueAt ?? null,
      createdBy,
      now,
      now,
    )
    .run();
  await logEvent(env.DB, {
    type: 'admin.task_created',
    actorKind: 'admin',
    actorId: createdBy,
    subjectKind: 'task',
    subjectId: id,
    requestId: reqMeta.requestId,
    ip: reqMeta.ip,
    payload: { title: input.title, customerId: input.customerId, orderId: input.orderId },
  });
  const row = await env.DB.prepare(`SELECT * FROM admin_tasks WHERE id = ?`).bind(id).first<Record<string, unknown>>();
  return hydrateTask(row!);
}

export async function patchTask(
  env: Env,
  taskId: string,
  patch: z.infer<typeof TaskPatch>,
  actor: string,
  reqMeta: { requestId: string; ip: string },
): Promise<TaskRow> {
  const existing = await env.DB.prepare(`SELECT * FROM admin_tasks WHERE id = ?`)
    .bind(taskId)
    .first<Record<string, unknown>>();
  if (!existing) throw Errors.notFound('Task not found');
  const sets: string[] = [];
  const args: unknown[] = [];
  if (patch.title !== undefined) { sets.push('title = ?'); args.push(patch.title); }
  if (patch.description !== undefined) { sets.push('description = ?'); args.push(patch.description); }
  if (patch.dueAt !== undefined) { sets.push('due_at = ?'); args.push(patch.dueAt); }
  if (patch.completed !== undefined) {
    sets.push('completed_at = ?'); args.push(patch.completed ? Date.now() : null);
  }
  if (sets.length === 0) return hydrateTask(existing);
  sets.push('updated_at = ?'); args.push(Date.now());
  args.push(taskId);
  await env.DB.prepare(`UPDATE admin_tasks SET ${sets.join(', ')} WHERE id = ?`).bind(...args).run();
  await logEvent(env.DB, {
    type: 'admin.task_updated',
    actorKind: 'admin',
    actorId: actor,
    subjectKind: 'task',
    subjectId: taskId,
    requestId: reqMeta.requestId,
    ip: reqMeta.ip,
    payload: { patch },
  });
  const row = await env.DB.prepare(`SELECT * FROM admin_tasks WHERE id = ?`).bind(taskId).first<Record<string, unknown>>();
  return hydrateTask(row!);
}

export async function deleteTask(env: Env, taskId: string) {
  await env.DB.prepare(`DELETE FROM admin_tasks WHERE id = ?`).bind(taskId).run();
}

// ---------------------------------------------------------------------------
// Customer view: aggregate profile + quotes + orders + events + notes
// ---------------------------------------------------------------------------

export async function searchCustomers(env: Env, q: string, limit = 50) {
  const needle = `%${q.toLowerCase()}%`;
  const { results } = await env.DB.prepare(
    `SELECT id, email, name, company, region, created_at, last_login_at
       FROM customers
      WHERE LOWER(email) LIKE ?
         OR LOWER(IFNULL(name, '')) LIKE ?
         OR LOWER(IFNULL(company, '')) LIKE ?
      ORDER BY created_at DESC
      LIMIT ?`,
  )
    .bind(needle, needle, needle, limit)
    .all();
  return results ?? [];
}

export async function listCustomersAdmin(env: Env, limit = 100) {
  const { results } = await env.DB.prepare(
    `SELECT id, email, name, company, region, created_at, last_login_at
       FROM customers ORDER BY created_at DESC LIMIT ?`,
  )
    .bind(limit)
    .all();
  return results ?? [];
}

export async function getCustomerView(env: Env, customerId: string) {
  // Accept either the canonical customer id or an email — ops often types
  // an email from a lead row and expects to land on the customer profile.
  const lookup = customerId.includes('@')
    ? env.DB.prepare(`SELECT * FROM customers WHERE LOWER(email) = LOWER(?)`).bind(customerId)
    : env.DB.prepare(`SELECT * FROM customers WHERE id = ?`).bind(customerId);
  const customer = await lookup.first<Record<string, unknown>>();
  if (!customer) return null;
  const cid = String(customer.id);
  const [orders, quotes, configurations, notes, events, tasks] = await Promise.all([
    env.DB.prepare(`SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC LIMIT 100`)
      .bind(cid).all(),
    env.DB.prepare(`SELECT * FROM quotes WHERE customer_id = ? ORDER BY created_at DESC LIMIT 100`)
      .bind(cid).all(),
    env.DB.prepare(
      `SELECT id, source, region, totals_json, catalog_version, created_at
         FROM configurations WHERE customer_id = ? ORDER BY created_at DESC LIMIT 100`,
    ).bind(cid).all(),
    env.DB.prepare(
      `SELECT id, body, author_id, created_at FROM customer_notes
        WHERE customer_id = ? ORDER BY created_at DESC LIMIT 200`,
    ).bind(cid).all(),
    env.DB.prepare(
      `SELECT id, ts, type, actor_kind, subject_kind, subject_id, payload_json
         FROM events
        WHERE (subject_kind = 'customer' AND subject_id = ?)
           OR (subject_kind = 'order' AND subject_id IN (SELECT id FROM orders WHERE customer_id = ?))
           OR (subject_kind = 'quote' AND subject_id IN (SELECT id FROM quotes WHERE customer_id = ?))
        ORDER BY ts DESC LIMIT 200`,
    ).bind(cid, cid, cid).all(),
    listTasks(env, { customerId: cid, status: 'all' }),
  ]);
  return {
    customer,
    orders: orders.results ?? [],
    quotes: quotes.results ?? [],
    configurations: configurations.results ?? [],
    notes: notes.results ?? [],
    events: events.results ?? [],
    tasks,
  };
}

// ---------------------------------------------------------------------------
// Lead status update
// ---------------------------------------------------------------------------

export const LeadPatch = z.object({
  status: z.enum(['new', 'contacted', 'qualified', 'closed', 'spam']).optional(),
  notes: z.string().max(4000).optional(),
});

export async function patchLead(
  env: Env,
  leadId: string,
  patch: z.infer<typeof LeadPatch>,
  actor: string,
  reqMeta: { requestId: string; ip: string },
) {
  const sets: string[] = [];
  const args: unknown[] = [];
  if (patch.status) { sets.push('status = ?'); args.push(patch.status); }
  if (patch.notes !== undefined) { sets.push('message = COALESCE(message, "") || char(10) || ?'); args.push(`[${new Date().toISOString()} ${actor}] ${patch.notes}`); }
  if (!sets.length) return;
  sets.push('updated_at = ?'); args.push(Date.now());
  args.push(leadId);
  await env.DB.prepare(`UPDATE leads SET ${sets.join(', ')} WHERE id = ?`).bind(...args).run();
  await logEvent(env.DB, {
    type: 'lead.updated',
    actorKind: 'admin',
    actorId: actor,
    subjectKind: 'lead',
    subjectId: leadId,
    requestId: reqMeta.requestId,
    ip: reqMeta.ip,
    payload: { patch },
  });
}

// ---------------------------------------------------------------------------
// Dashboard counts (extends the basic dashboardSummary in services/orders)
// ---------------------------------------------------------------------------

export async function dashboardCounts(env: Env) {
  const week = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const [leadsWeek, quotesWeek, ordersWeek, deposit, conv, leadsBySource, ordersByStatus] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS n FROM leads WHERE created_at >= ?`).bind(week).first<{ n: number }>(),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM quotes WHERE created_at >= ?`).bind(week).first<{ n: number }>(),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM orders WHERE created_at >= ?`).bind(week).first<{ n: number }>(),
    env.DB.prepare(
      `SELECT COALESCE(SUM(deposit_cents), 0) AS pipeline_cents
         FROM orders WHERE status IN ('awaiting_deposit','reserved','in_production')`,
    ).first<{ pipeline_cents: number }>(),
    env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM leads) AS leads,
         (SELECT COUNT(*) FROM quotes) AS quotes,
         (SELECT COUNT(*) FROM orders) AS orders,
         (SELECT COUNT(*) FROM orders WHERE status IN ('delivered','shipping')) AS won`,
    ).first<{ leads: number; quotes: number; orders: number; won: number }>(),
    env.DB.prepare(`SELECT kind, COUNT(*) AS n FROM leads GROUP BY kind`).all(),
    env.DB.prepare(`SELECT status, COUNT(*) AS n FROM orders GROUP BY status`).all(),
  ]);
  const total = conv?.leads ?? 0;
  const conversion = {
    leadToQuote: total ? (conv!.quotes / total) : 0,
    quoteToOrder: conv?.quotes ? (conv!.orders / conv!.quotes) : 0,
    orderToWon: conv?.orders ? (conv!.won / conv!.orders) : 0,
  };
  return {
    weekly: {
      leads: leadsWeek?.n ?? 0,
      quotes: quotesWeek?.n ?? 0,
      orders: ordersWeek?.n ?? 0,
    },
    depositPipelineCents: deposit?.pipeline_cents ?? 0,
    conversion,
    leadsBySource: leadsBySource.results ?? [],
    ordersByStatus: ordersByStatus.results ?? [],
  };
}
