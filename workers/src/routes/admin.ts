import { Hono } from 'hono';
import type { AppContext } from '../env';
import { Errors } from '../lib/errors';
import { requireAdmin } from '../middleware/auth';
import {
  OrderPatch,
  dashboardSummary,
  getOrderAdmin,
  listOrdersAdmin,
  patchOrderAdmin,
} from '../services/orders';
import { listQuotesAdmin } from '../services/quotes';
import { listLeadsAdmin } from '../services/leads';
import { newShortId } from '../lib/ids';
import { logEvent } from '../db/events';
import { z } from 'zod';

export const admin = new Hono<AppContext>();
admin.use('*', requireAdmin);

admin.get('/dashboard', async (c) => {
  const data = await dashboardSummary(c.env);
  return c.json({ data });
});

admin.get('/orders', async (c) => {
  const status = c.req.query('status') ?? undefined;
  const limit = Math.min(parseInt(c.req.query('limit') ?? '100', 10) || 100, 500);
  const data = await listOrdersAdmin(c.env, status, limit);
  return c.json({ data });
});

admin.get('/orders/:id', async (c) => {
  const order = await getOrderAdmin(c.env, c.req.param('id'));
  if (!order) throw Errors.notFound('Order not found');
  return c.json({ data: order });
});

admin.patch('/orders/:id', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = OrderPatch.safeParse(body);
  if (!parsed.success) throw Errors.invalid(parsed.error.flatten());
  const order = await patchOrderAdmin(c.env, c.req.param('id'), parsed.data, {
    requestId: c.get('requestId'),
    ip: c.get('ip'),
  });
  return c.json({ data: order });
});

const InvoiceBalanceInput = z.object({
  amountCents: z.number().int().positive().optional(),
  notes: z.string().max(1000).optional(),
});

admin.post('/orders/:id/invoice-balance', async (c) => {
  const orderId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const parsed = InvoiceBalanceInput.safeParse(body);
  if (!parsed.success) throw Errors.invalid(parsed.error.flatten());
  const order = await getOrderAdmin(c.env, orderId);
  if (!order) throw Errors.notFound('Order not found');
  const balance = order.totalCents - order.depositPaidCents - order.balancePaidCents;
  const amount = parsed.data.amountCents ?? balance;
  if (amount <= 0) throw Errors.badRequest('No balance owed');

  const id = newShortId();
  const now = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO invoices (id, order_id, kind, amount_cents, currency, issued_at, created_at)
     VALUES (?, ?, 'balance', ?, ?, ?, ?)`,
  )
    .bind(id, orderId, amount, order.currency, now, now)
    .run();
  await logEvent(c.env.DB, {
    type: 'invoice.issued',
    actorKind: 'admin',
    subjectKind: 'order',
    subjectId: orderId,
    requestId: c.get('requestId'),
    ip: c.get('ip'),
    payload: { invoiceId: id, kind: 'balance', amountCents: amount, notes: parsed.data.notes },
  });
  return c.json({ data: { id, orderId, amountCents: amount, kind: 'balance', issuedAt: now } }, 201);
});

const RefundInput = z.object({
  orderId: z.string().min(1),
  amountCents: z.number().int().positive(),
  reason: z.string().max(1000).optional(),
});

admin.post('/refunds', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = RefundInput.safeParse(body);
  if (!parsed.success) throw Errors.invalid(parsed.error.flatten());
  const order = await getOrderAdmin(c.env, parsed.data.orderId);
  if (!order) throw Errors.notFound('Order not found');
  // Stripe execution lands in next task; here we record the intent + invoice row.
  const id = newShortId();
  const now = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO invoices (id, order_id, kind, amount_cents, currency, issued_at, created_at)
     VALUES (?, ?, 'refund', ?, ?, ?, ?)`,
  )
    .bind(id, order.id, parsed.data.amountCents, order.currency, now, now)
    .run();
  await logEvent(c.env.DB, {
    type: 'refund.requested',
    actorKind: 'admin',
    subjectKind: 'order',
    subjectId: order.id,
    requestId: c.get('requestId'),
    ip: c.get('ip'),
    payload: { invoiceId: id, amountCents: parsed.data.amountCents, reason: parsed.data.reason },
  });
  return c.json({ data: { id, orderId: order.id, amountCents: parsed.data.amountCents } }, 201);
});

admin.get('/quotes', async (c) => {
  const status = c.req.query('status') ?? undefined;
  const limit = Math.min(parseInt(c.req.query('limit') ?? '100', 10) || 100, 500);
  const data = await listQuotesAdmin(c.env, status, limit);
  return c.json({ data });
});

admin.get('/leads', async (c) => {
  const kind = c.req.query('kind') ?? undefined;
  const status = c.req.query('status') ?? undefined;
  const limit = Math.min(parseInt(c.req.query('limit') ?? '200', 10) || 200, 500);
  const data = await listLeadsAdmin(c.env, kind, status, limit);
  return c.json({ data });
});
