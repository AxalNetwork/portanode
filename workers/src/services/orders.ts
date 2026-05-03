import { z } from 'zod';
import type { Env } from '../env';
import { Errors } from '../lib/errors';
import { newShortId } from '../lib/ids';
import { logEvent } from '../db/events';

export const OrderNoteInput = z.object({
  body: z.string().min(1).max(4000),
});

export const OrderPatch = z.object({
  status: z
    .enum(['awaiting_deposit', 'reserved', 'in_production', 'shipping', 'delivered', 'cancelled', 'refunded'])
    .optional(),
  expectedShipAt: z.number().int().positive().nullable().optional(),
  shippedAt: z.number().int().positive().nullable().optional(),
  deliveredAt: z.number().int().positive().nullable().optional(),
  shippingAddress: z.record(z.string(), z.unknown()).optional(),
  trackingCarrier: z.string().max(80).nullable().optional(),
  trackingNumber: z.string().max(80).nullable().optional(),
  trackingUrl: z.string().url().nullable().optional(),
});

export async function listOrdersForCustomer(env: Env, customerId: string) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC LIMIT 100`,
  )
    .bind(customerId)
    .all();
  return (results ?? []).map(hydrateOrder);
}

export async function getOrderForCustomer(env: Env, customerId: string, orderId: string) {
  const row = await env.DB.prepare(`SELECT * FROM orders WHERE id = ? AND customer_id = ?`)
    .bind(orderId, customerId)
    .first();
  return row ? hydrateOrder(row as Record<string, unknown>) : null;
}

export async function getOrderAdmin(env: Env, orderId: string) {
  const row = await env.DB.prepare(`SELECT * FROM orders WHERE id = ?`).bind(orderId).first();
  return row ? hydrateOrder(row as Record<string, unknown>) : null;
}

export async function listOrdersAdmin(env: Env, status?: string, limit = 100) {
  const sql = status
    ? `SELECT * FROM orders WHERE status = ? ORDER BY created_at DESC LIMIT ?`
    : `SELECT * FROM orders ORDER BY created_at DESC LIMIT ?`;
  const stmt = status ? env.DB.prepare(sql).bind(status, limit) : env.DB.prepare(sql).bind(limit);
  const { results } = await stmt.all();
  return (results ?? []).map(hydrateOrder);
}

export async function patchOrderAdmin(
  env: Env,
  orderId: string,
  patch: z.infer<typeof OrderPatch>,
  reqMeta: { requestId: string; ip: string },
) {
  const order = await getOrderAdmin(env, orderId);
  if (!order) throw Errors.notFound('Order not found');

  const sets: string[] = [];
  const args: unknown[] = [];
  const changed: Record<string, unknown> = {};
  if (patch.status !== undefined) { sets.push('status = ?'); args.push(patch.status); changed.status = patch.status; }
  if (patch.expectedShipAt !== undefined) { sets.push('expected_ship_at = ?'); args.push(patch.expectedShipAt); changed.expectedShipAt = patch.expectedShipAt; }
  if (patch.shippedAt !== undefined) { sets.push('shipped_at = ?'); args.push(patch.shippedAt); changed.shippedAt = patch.shippedAt; }
  if (patch.deliveredAt !== undefined) { sets.push('delivered_at = ?'); args.push(patch.deliveredAt); changed.deliveredAt = patch.deliveredAt; }
  if (patch.shippingAddress !== undefined) {
    sets.push('shipping_address_json = ?');
    args.push(JSON.stringify(patch.shippingAddress));
    changed.shippingAddress = true;
  }
  if (patch.trackingCarrier !== undefined) { sets.push('tracking_carrier = ?'); args.push(patch.trackingCarrier); changed.trackingCarrier = patch.trackingCarrier; }
  if (patch.trackingNumber !== undefined) { sets.push('tracking_number = ?'); args.push(patch.trackingNumber); changed.trackingNumber = patch.trackingNumber; }
  if (patch.trackingUrl !== undefined) { sets.push('tracking_url = ?'); args.push(patch.trackingUrl); changed.trackingUrl = patch.trackingUrl; }
  if (sets.length === 0) return order;
  sets.push('updated_at = ?');
  args.push(Date.now());
  args.push(orderId);

  await env.DB.prepare(`UPDATE orders SET ${sets.join(', ')} WHERE id = ?`).bind(...args).run();
  await logEvent(env.DB, {
    type: 'order.updated',
    actorKind: 'admin',
    subjectKind: 'order',
    subjectId: orderId,
    requestId: reqMeta.requestId,
    ip: reqMeta.ip,
    payload: { changed },
  });
  return getOrderAdmin(env, orderId);
}

export async function addOrderNoteCustomer(
  env: Env,
  orderId: string,
  customerId: string,
  body: string,
  reqMeta: { requestId: string; ip: string },
) {
  const order = await getOrderForCustomer(env, customerId, orderId);
  if (!order) throw Errors.notFound('Order not found');
  const id = newShortId();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO order_notes (id, order_id, author_kind, author_id, body, created_at)
     VALUES (?, ?, 'customer', ?, ?, ?)`,
  )
    .bind(id, orderId, customerId, body, now)
    .run();
  await logEvent(env.DB, {
    type: 'order.note_added',
    actorKind: 'customer',
    actorId: customerId,
    subjectKind: 'order',
    subjectId: orderId,
    requestId: reqMeta.requestId,
    ip: reqMeta.ip,
  });
  return { id, createdAt: now };
}

export async function getInvoiceForCustomer(env: Env, customerId: string, invoiceId: string) {
  const row = await env.DB.prepare(
    `SELECT i.* FROM invoices i
       JOIN orders o ON o.id = i.order_id
      WHERE i.id = ? AND o.customer_id = ?`,
  )
    .bind(invoiceId, customerId)
    .first<Record<string, unknown>>();
  if (!row) return null;
  return {
    id: String(row.id),
    orderId: String(row.order_id),
    kind: String(row.kind),
    amountCents: Number(row.amount_cents),
    currency: String(row.currency),
    pdfR2Key: row.pdf_r2_key as string | null,
    issuedAt: Number(row.issued_at),
    paidAt: row.paid_at ? Number(row.paid_at) : null,
  };
}

export async function dashboardSummary(env: Env) {
  const [orders, quotes, leads, revenue] = await Promise.all([
    env.DB.prepare(`SELECT status, COUNT(*) AS n FROM orders GROUP BY status`).all(),
    env.DB.prepare(`SELECT status, COUNT(*) AS n FROM quotes GROUP BY status`).all(),
    env.DB.prepare(`SELECT kind, COUNT(*) AS n FROM leads GROUP BY kind`).all(),
    env.DB.prepare(
      `SELECT COALESCE(SUM(deposit_paid_cents + balance_paid_cents - refunded_cents), 0) AS rev
         FROM orders`,
    ).first<{ rev: number }>(),
  ]);
  return {
    orders: orders.results ?? [],
    quotes: quotes.results ?? [],
    leads: leads.results ?? [],
    netRevenueCents: revenue?.rev ?? 0,
  };
}

function hydrateOrder(r: Record<string, unknown>) {
  return {
    id: String(r.id),
    customerId: String(r.customer_id),
    quoteId: r.quote_id as string | null,
    configurationId: String(r.configuration_id),
    status: String(r.status),
    region: String(r.region),
    currency: String(r.currency),
    fxRate: Number(r.fx_rate ?? 1),
    subtotalCents: Number(r.subtotal_cents),
    freightCents: Number(r.freight_cents),
    taxCents: Number(r.tax_cents),
    totalCents: Number(r.total_cents),
    depositCents: Number(r.deposit_cents),
    depositPaidCents: Number(r.deposit_paid_cents),
    balancePaidCents: Number(r.balance_paid_cents),
    refundedCents: Number(r.refunded_cents),
    stripeCustomerId: r.stripe_customer_id as string | null,
    stripeCheckoutId: r.stripe_checkout_id as string | null,
    stripePaymentIntentId: r.stripe_payment_intent_id as string | null,
    shippingAddress: r.shipping_address_json
      ? JSON.parse(String(r.shipping_address_json))
      : null,
    expectedShipAt: r.expected_ship_at ? Number(r.expected_ship_at) : null,
    shippedAt: r.shipped_at ? Number(r.shipped_at) : null,
    deliveredAt: r.delivered_at ? Number(r.delivered_at) : null,
    trackingCarrier: (r.tracking_carrier as string) ?? null,
    trackingNumber: (r.tracking_number as string) ?? null,
    trackingUrl: (r.tracking_url as string) ?? null,
    kybStatus: (r.kyb_status as string) ?? 'not_required',
    kybProviderRef: (r.kyb_provider_ref as string) ?? null,
    kybReviewedAt: r.kyb_reviewed_at ? Number(r.kyb_reviewed_at) : null,
    kybReviewedBy: (r.kyb_reviewed_by as string) ?? null,
    cancelledAt: r.cancelled_at ? Number(r.cancelled_at) : null,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}
