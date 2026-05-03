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
import { computeRefundEligibility, executeStripeRefund } from '../stripe/refunds';
import { ensureCustomer, createBalanceInvoice } from '../stripe/invoices';
import { StripeApiError } from '../stripe/client';
import { convertCentsByRate } from '../lib/fx';
import { registerAdminPublic, registerAdminProtected } from './admin-extra';

export const admin = new Hono<AppContext>();

// Public endpoints (login / logout) must register BEFORE the requireAdmin
// middleware so they remain reachable without a cookie. They still validate
// the bearer token internally before issuing or revoking sessions.
registerAdminPublic(admin);

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
  description: z.string().max(500).optional(),
  daysUntilDue: z.number().int().min(1).max(120).optional(),
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

  // Best-effort Stripe push. If Stripe isn't configured or the call fails,
  // we still return the local invoice row so ops can resend manually.
  let stripeInvoice: { id?: string; hosted_invoice_url?: string | null } | null = null;
  if (c.env.STRIPE_SECRET_KEY) {
    try {
      const customerRow = await c.env.DB.prepare(
        `SELECT email, name, company, phone FROM customers WHERE id = ?`,
      )
        .bind(order.customerId)
        .first<{ email: string; name: string | null; company: string | null; phone: string | null }>();
      if (customerRow) {
        const customer = await ensureCustomer(c.env, {
          email: customerRow.email,
          name: customerRow.name,
          company: customerRow.company,
          phone: customerRow.phone,
          existingId: order.stripeCustomerId,
        });
        // The local invoice ledger row stores canonical USD cents; the
        // Stripe invoice itself must be expressed in the customer's
        // presentment currency, so convert via the order's snapshotted
        // fx_rate before handing off.
        const presentmentAmount = convertCentsByRate(amount, order.fxRate, order.currency);
        stripeInvoice = await createBalanceInvoice(c.env, {
          customerId: customer.id,
          orderId,
          invoiceLedgerId: id,
          amountCents: presentmentAmount,
          currency: order.currency,
          description: parsed.data.description ?? `Balance due for order ${orderId}`,
          daysUntilDue: parsed.data.daysUntilDue,
        });
        if (stripeInvoice?.id) {
          await c.env.DB.prepare(
            `UPDATE invoices SET stripe_invoice_id = ? WHERE id = ?`,
          )
            .bind(stripeInvoice.id, id)
            .run();
        }
      }
    } catch (err) {
      const msg = err instanceof StripeApiError ? err.message : err instanceof Error ? err.message : String(err);
      await logEvent(c.env.DB, {
        type: 'invoice.stripe_failed',
        actorKind: 'admin',
        subjectKind: 'order',
        subjectId: orderId,
        requestId: c.get('requestId'),
        ip: c.get('ip'),
        payload: { invoiceId: id, err: msg },
      });
    }
  }

  await logEvent(c.env.DB, {
    type: 'invoice.issued',
    actorKind: 'admin',
    subjectKind: 'order',
    subjectId: orderId,
    requestId: c.get('requestId'),
    ip: c.get('ip'),
    payload: {
      invoiceId: id,
      kind: 'balance',
      amountCents: amount,
      stripeInvoiceId: stripeInvoice?.id ?? null,
      hostedUrl: stripeInvoice?.hosted_invoice_url ?? null,
    },
  });
  return c.json(
    {
      data: {
        id,
        orderId,
        amountCents: amount,
        kind: 'balance',
        issuedAt: now,
        stripeInvoiceId: stripeInvoice?.id ?? null,
        hostedUrl: stripeInvoice?.hosted_invoice_url ?? null,
      },
    },
    201,
  );
});

const RefundInput = z.object({
  orderId: z.string().min(1),
  amountCents: z.number().int().positive().optional(),
  reason: z.string().max(1000).optional(),
  override: z.boolean().optional(),
});

admin.post('/refunds', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = RefundInput.safeParse(body);
  if (!parsed.success) throw Errors.invalid(parsed.error.flatten());
  const order = await getOrderAdmin(c.env, parsed.data.orderId);
  if (!order) throw Errors.notFound('Order not found');

  const eligibility = computeRefundEligibility(order);
  let amount = parsed.data.amountCents ?? eligibility.maxRefundCents;
  let band = eligibility.band;
  if (parsed.data.override) {
    band = 'override';
  } else if (amount > eligibility.maxRefundCents) {
    throw Errors.badRequest(
      `Amount exceeds policy maximum (${eligibility.maxRefundCents} cents — ${eligibility.reason}). Set override=true to bypass.`,
    );
  }
  if (amount <= 0) throw Errors.badRequest(eligibility.reason);

  const id = newShortId();
  const now = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO refunds (id, order_id, amount_cents, currency, reason, policy_band, status, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
  )
    .bind(
      id,
      order.id,
      amount,
      order.currency,
      parsed.data.reason ?? null,
      band,
      c.get('admin')?.tokenHashPrefix ?? 'admin',
      now,
      now,
    )
    .run();
  await c.env.DB.prepare(
    `INSERT INTO invoices (id, order_id, kind, amount_cents, currency, issued_at, created_at)
     VALUES (?, ?, 'refund', ?, ?, ?, ?)`,
  )
    .bind(newShortId(), order.id, amount, order.currency, now, now)
    .run();

  let stripeRefundId: string | null = null;
  if (c.env.STRIPE_SECRET_KEY && order.stripePaymentIntentId) {
    try {
      // Internal ledger holds USD cents; Stripe expects the refund amount in
      // the original payment's presentment minor units, so convert via the
      // order's snapshotted fx_rate before crossing the API boundary.
      const presentmentRefund = convertCentsByRate(amount, order.fxRate, order.currency);
      const refund = await executeStripeRefund(c.env, {
        paymentIntentId: order.stripePaymentIntentId,
        amountCents: presentmentRefund,
        reason: 'requested_by_customer',
        refundLedgerId: id,
        metadata: { order_id: order.id, band },
      });
      stripeRefundId = refund.id;
      await c.env.DB.prepare(
        `UPDATE refunds SET stripe_refund_id = ?, status = ?, updated_at = ? WHERE id = ?`,
      )
        .bind(refund.id, refund.status === 'succeeded' ? 'succeeded' : 'pending', Date.now(), id)
        .run();
      if (refund.status === 'succeeded') {
        await c.env.DB.prepare(
          `UPDATE orders SET refunded_cents = refunded_cents + ?, updated_at = ? WHERE id = ?`,
        )
          .bind(amount, Date.now(), order.id)
          .run();
      }
    } catch (err) {
      const msg = err instanceof StripeApiError ? err.message : err instanceof Error ? err.message : String(err);
      await c.env.DB.prepare(
        `UPDATE refunds SET status = 'failed', updated_at = ? WHERE id = ?`,
      )
        .bind(Date.now(), id)
        .run();
      await logEvent(c.env.DB, {
        type: 'refund.stripe_failed',
        actorKind: 'admin',
        subjectKind: 'order',
        subjectId: order.id,
        requestId: c.get('requestId'),
        ip: c.get('ip'),
        payload: { refundId: id, err: msg },
      });
      throw Errors.badRequest(`Stripe refund failed: ${msg}`);
    }
  }

  await logEvent(c.env.DB, {
    type: 'refund.requested',
    actorKind: 'admin',
    subjectKind: 'order',
    subjectId: order.id,
    requestId: c.get('requestId'),
    ip: c.get('ip'),
    payload: {
      refundId: id,
      amountCents: amount,
      band,
      reason: parsed.data.reason,
      stripeRefundId,
      policy: eligibility.reason,
    },
  });
  return c.json(
    { data: { id, orderId: order.id, amountCents: amount, band, stripeRefundId, policy: eligibility } },
    201,
  );
});

admin.get('/orders/:id/refund-eligibility', async (c) => {
  const order = await getOrderAdmin(c.env, c.req.param('id'));
  if (!order) throw Errors.notFound('Order not found');
  return c.json({ data: computeRefundEligibility(order) });
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

// CRM extras (customers, notes, tasks, pricing review, exports, cron triggers).
// Registered after `admin.use('*', requireAdmin)` so they all sit behind auth.
registerAdminProtected(admin);
