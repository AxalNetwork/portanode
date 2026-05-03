import { Hono } from 'hono';
import type { AppContext } from '../env';
import { verifyWebhook, type StripeEvent } from '../stripe/webhook';
import { logEvent } from '../db/events';
import { log } from '../lib/log';
import { newOrderId, newCustomerId } from '../lib/ids';
import { getQuoteById, markQuoteAccepted } from '../services/quotes';
import { sendEmail } from '../email/send';
import { presentmentToUsdCents } from '../lib/fx';
import { shouldHoldForKyb, kybThresholdCents } from '../lib/kyb';
import { screenAndRecordCustomer } from '../lib/sanctions';

interface QuoteDepositSnapshot {
  currency: string;
  fxRate: number;
  depositCents: number;
}

/**
 * Normalize a Stripe Checkout `amount_total` (presentment minor units, e.g.
 * EUR cents or JPY yen) back into canonical USD cents using the rate we
 * snapshotted on the quote. Falls back to the quoted deposit when Stripe
 * omits the value so we never write a NULL/zero into the order ledger.
 */
function depositPaidUsdCents(
  session: { amount_total: number | null; currency: string },
  quote: QuoteDepositSnapshot,
): number {
  if (session.amount_total == null) return quote.depositCents;
  return presentmentToUsdCents(session.amount_total, quote.fxRate, session.currency || quote.currency);
}

export const stripe = new Hono<AppContext>();

/**
 * Stripe Checkout success-return endpoint. The Checkout Session's success_url
 * uses the `{CHECKOUT_SESSION_ID}` placeholder; here we resolve that back to
 * our internal order id (created by the `checkout.session.completed` webhook)
 * and 302 the customer to the proper portal page.
 *
 * Race-tolerant: if the webhook hasn't landed yet, we still redirect to the
 * portal index with `?pending={session_id}` so the customer sees a friendly
 * "processing" state instead of a 404.
 */
stripe.get('/return', async (c) => {
  const sessionId = c.req.query('session_id') ?? '';
  if (!sessionId) {
    return c.redirect(`${c.env.APP_BASE_URL}/account/`, 302);
  }
  const row = await c.env.DB.prepare(
    `SELECT id FROM orders WHERE stripe_checkout_id = ? LIMIT 1`,
  )
    .bind(sessionId)
    .first<{ id: string }>();
  const target = row
    ? `${c.env.APP_BASE_URL}/account/orders/${encodeURIComponent(row.id)}?success=1`
    : `${c.env.APP_BASE_URL}/account/?success=1&pending=${encodeURIComponent(sessionId)}`;
  return c.redirect(target, 302);
});

/**
 * Stripe webhook receiver.
 *
 * Stripe expects 4xx on invalid signatures (so it stops retrying a hostile /
 * misconfigured caller); we 200 once the event is durably persisted to the
 * `stripe_events` ledger so retries collapse server-side.
 */
stripe.post('/webhook', async (c) => {
  const raw = await c.req.text();
  const sig = c.req.header('stripe-signature') ?? null;
  const verified = await verifyWebhook(c.env, raw, sig);
  if (!verified.ok || !verified.event) {
    log.warn({
      requestId: c.get('requestId'),
      msg: 'stripe.webhook.invalid',
      err: verified.error,
    });
    return c.json({ error: { code: 'invalid_signature', message: verified.error ?? 'invalid' } }, 400);
  }
  const event = verified.event;

  // Insert idempotently. If we've seen this event before, short-circuit.
  const existing = await c.env.DB.prepare(`SELECT status FROM stripe_events WHERE id = ?`)
    .bind(event.id)
    .first<{ status: string }>();
  if (existing && existing.status === 'processed') {
    return c.json({ received: true, duplicate: true });
  }
  if (!existing) {
    await c.env.DB.prepare(
      `INSERT INTO stripe_events (id, type, livemode, received_at, status, payload_json)
       VALUES (?, ?, ?, ?, 'received', ?)`,
    )
      .bind(event.id, event.type, event.livemode ? 1 : 0, Date.now(), raw)
      .run();
  }

  let status: 'processed' | 'failed' | 'ignored' = 'ignored';
  let error: string | null = null;
  try {
    status = await dispatchEvent(c.env, event, c.get('requestId'));
  } catch (err) {
    status = 'failed';
    error = err instanceof Error ? err.message : String(err);
    log.error({
      requestId: c.get('requestId'),
      msg: 'stripe.webhook.dispatch_error',
      eventId: event.id,
      type: event.type,
      err: error,
    });
  }

  await c.env.DB.prepare(
    `UPDATE stripe_events SET status = ?, processed_at = ?, error = ? WHERE id = ?`,
  )
    .bind(status, Date.now(), error, event.id)
    .run();

  // Always 200 once persisted so Stripe stops retrying — failures are
  // visible in the events ledger and the audit log for ops to triage.
  return c.json({ received: true, status });
});

async function dispatchEvent(
  env: AppContext['Bindings'],
  event: StripeEvent,
  requestId: string,
): Promise<'processed' | 'ignored'> {
  switch (event.type) {
    case 'checkout.session.completed':
      await onCheckoutCompleted(env, event, requestId);
      return 'processed';
    case 'payment_intent.succeeded':
      await onPaymentSucceeded(env, event, requestId);
      return 'processed';
    case 'payment_intent.payment_failed':
      await onPaymentFailed(env, event, requestId);
      return 'processed';
    case 'invoice.paid':
      await onInvoicePaid(env, event, requestId);
      return 'processed';
    case 'invoice.payment_failed':
      await onInvoiceFailed(env, event, requestId);
      return 'processed';
    case 'charge.refunded':
      await onChargeRefunded(env, event, requestId);
      return 'processed';
    case 'charge.dispute.created':
      await onDisputeCreated(env, event, requestId);
      return 'processed';
    default:
      return 'ignored';
  }
}

interface SessionObj {
  id: string;
  payment_intent: string | null;
  customer: string | null;
  amount_total: number;
  currency: string;
  customer_details?: { email?: string; name?: string; phone?: string } | null;
  shipping_details?: { address?: Record<string, string>; name?: string } | null;
  metadata?: Record<string, string>;
}

async function onCheckoutCompleted(
  env: AppContext['Bindings'],
  event: StripeEvent,
  requestId: string,
) {
  const session = event.data.object as unknown as SessionObj;
  const quoteId = session.metadata?.quote_id;
  if (!quoteId) {
    await logEvent(env.DB, {
      type: 'stripe.checkout_completed_orphan',
      actorKind: 'stripe',
      requestId,
      payload: { sessionId: session.id },
    });
    return;
  }
  const quote = await getQuoteById(env, quoteId);
  if (!quote) throw new Error(`unknown quote ${quoteId}`);

  // Upsert a customer record so the order satisfies the NOT NULL FK.
  const email = session.customer_details?.email ?? quote.contact.email;
  const name = session.customer_details?.name ?? quote.contact.name ?? null;
  const upsert = await upsertCustomer(env, {
    email,
    name,
    company: quote.contact.company,
    phone: session.customer_details?.phone ?? quote.contact.phone,
    region: quote.region,
  });
  const customerId = upsert.id;
  // Sanctions screening at the second customer-creation site. Skipped for
  // existing customers (they were screened at first creation); new ones
  // get a synchronous screen + persisted row before order INSERT so the
  // KYB hold and the screening review can be triaged together by ops.
  if (upsert.created) {
    await screenAndRecordCustomer(env, {
      customerId,
      name: name ?? email,
      email,
      country: quote.contact.country ?? null,
      requestId,
    });
  }

  // Create the order if one doesn't already exist for this checkout id.
  const existing = await env.DB.prepare(`SELECT id FROM orders WHERE stripe_checkout_id = ?`)
    .bind(session.id)
    .first<{ id: string }>();
  let orderId = existing?.id;
  if (!orderId) {
    orderId = newOrderId();
    const now = Date.now();
    await env.DB.prepare(
      `INSERT INTO orders (
          id, customer_id, quote_id, configuration_id, status, region, currency, fx_rate,
          subtotal_cents, freight_cents, tax_cents, total_cents, deposit_cents,
          deposit_paid_cents, balance_paid_cents, refunded_cents,
          stripe_customer_id, stripe_checkout_id, stripe_payment_intent_id,
          shipping_address_json, kyb_status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'awaiting_deposit', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        orderId,
        customerId,
        quote.id,
        quote.configurationId,
        quote.region,
        quote.currency,
        quote.fxRate,
        quote.subtotalCents,
        quote.freightCents,
        quote.taxCents,
        quote.totalCents,
        quote.depositCents,
        // All order monetary columns are canonical USD cents. Stripe's
        // `amount_total` arrives in presentment minor units, so convert it
        // back using the rate snapshotted on the quote.
        depositPaidUsdCents(session, quote),
        session.customer ?? null,
        session.id,
        session.payment_intent ?? null,
        session.shipping_details ? JSON.stringify(session.shipping_details) : null,
        // KYB hold for orders ≥ threshold (default $250k). When `pending`,
        // ops must clear via the admin order view (Sumsub/Onfido/Persona)
        // before the production line picks up the order.
        shouldHoldForKyb(env, quote.totalCents) ? 'pending' : 'not_required',
        now,
        now,
      )
      .run();
    if (shouldHoldForKyb(env, quote.totalCents)) {
      await logEvent(env.DB, {
        type: 'compliance.kyb_pending',
        actorKind: 'system',
        subjectKind: 'order',
        subjectId: orderId,
        requestId,
        payload: { totalCents: quote.totalCents, thresholdCents: kybThresholdCents(env) },
      });
    }
  } else {
    await env.DB.prepare(
      `UPDATE orders
         SET status = 'reserved',
             deposit_paid_cents = ?,
             stripe_payment_intent_id = COALESCE(?, stripe_payment_intent_id),
             updated_at = ?
       WHERE id = ?`,
    )
      .bind(
        depositPaidUsdCents(session, quote),
        session.payment_intent ?? null,
        Date.now(),
        orderId,
      )
      .run();
  }

  await markQuoteAccepted(env, quote.id, {
    stripeCheckoutId: session.id,
    stripePaymentIntentId: session.payment_intent,
  });
  // Reflect the reserved-slot semantics in the order status.
  await env.DB.prepare(
    `UPDATE orders SET status = 'reserved', updated_at = ? WHERE id = ?`,
  )
    .bind(Date.now(), orderId)
    .run();

  await logEvent(env.DB, {
    type: 'order.deposit_paid',
    actorKind: 'stripe',
    actorId: session.id,
    subjectKind: 'order',
    subjectId: orderId,
    requestId,
    payload: {
      quoteId: quote.id,
      paymentIntent: session.payment_intent,
      amount: session.amount_total,
      currency: session.currency,
    },
  });

  await sendEmail(
    env,
    {
      to: email,
      template: 'order-deposit-received',
      subject: `Deposit received — order ${orderId}`,
      vars: {
        orderId,
        expectedShip: 'TBD',
        orderUrl: `${env.APP_BASE_URL}/account/orders/${orderId}`,
      },
    },
    { requestId, subjectKind: 'order', subjectId: orderId, actorKind: 'system' },
  );
}

async function upsertCustomer(
  env: AppContext['Bindings'],
  args: { email: string; name: string | null; company: string | null; phone: string | null; region: string },
): Promise<{ id: string; created: boolean }> {
  const existing = await env.DB.prepare(`SELECT id FROM customers WHERE email = ?`)
    .bind(args.email)
    .first<{ id: string }>();
  if (existing) return { id: existing.id, created: false };
  const id = newCustomerId();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO customers (id, email, name, company, phone, region, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, args.email, args.name, args.company, args.phone, args.region, now, now)
    .run();
  return { id, created: true };
}

interface PaymentIntentObj {
  id: string;
  amount: number;
  currency: string;
  metadata?: Record<string, string>;
  last_payment_error?: { message?: string; code?: string } | null;
}

async function onPaymentSucceeded(
  env: AppContext['Bindings'],
  event: StripeEvent,
  requestId: string,
) {
  const pi = event.data.object as unknown as PaymentIntentObj;
  const order = await env.DB.prepare(`SELECT id FROM orders WHERE stripe_payment_intent_id = ?`)
    .bind(pi.id)
    .first<{ id: string }>();
  await logEvent(env.DB, {
    type: 'payment.succeeded',
    actorKind: 'stripe',
    actorId: pi.id,
    subjectKind: order ? 'order' : null,
    subjectId: order?.id ?? null,
    requestId,
    payload: { amount: pi.amount, currency: pi.currency, quoteId: pi.metadata?.quote_id },
  });
}

async function onPaymentFailed(env: AppContext['Bindings'], event: StripeEvent, requestId: string) {
  const pi = event.data.object as unknown as PaymentIntentObj;
  await logEvent(env.DB, {
    type: 'payment.failed',
    actorKind: 'stripe',
    actorId: pi.id,
    subjectKind: 'payment_intent',
    subjectId: pi.id,
    requestId,
    payload: {
      amount: pi.amount,
      currency: pi.currency,
      err: pi.last_payment_error?.message,
      code: pi.last_payment_error?.code,
      quoteId: pi.metadata?.quote_id,
    },
  });
}

interface InvoiceObj {
  id: string;
  amount_paid: number;
  amount_due: number;
  currency: string;
  hosted_invoice_url: string | null;
  invoice_pdf: string | null;
  metadata?: Record<string, string>;
}

async function onInvoicePaid(env: AppContext['Bindings'], event: StripeEvent, requestId: string) {
  const inv = event.data.object as unknown as InvoiceObj;
  const ledgerId = inv.metadata?.ledger_id;
  const orderId = inv.metadata?.order_id;
  if (ledgerId) {
    await env.DB.prepare(
      `UPDATE invoices SET stripe_invoice_id = ?, paid_at = ? WHERE id = ?`,
    )
      .bind(inv.id, Date.now(), ledgerId)
      .run();
  }
  if (orderId) {
    // `inv.amount_paid` is in presentment minor units; orders.balance_paid_cents
    // is canonical USD cents — convert via the order's snapshotted fx_rate.
    const orderRow = await env.DB.prepare(
      `SELECT fx_rate, currency FROM orders WHERE id = ?`,
    )
      .bind(orderId)
      .first<{ fx_rate: number; currency: string }>();
    const paidUsdCents = orderRow
      ? presentmentToUsdCents(
          inv.amount_paid,
          Number(orderRow.fx_rate ?? 1),
          inv.currency || orderRow.currency,
        )
      : inv.amount_paid;
    await env.DB.prepare(
      `UPDATE orders
          SET balance_paid_cents = balance_paid_cents + ?,
              updated_at = ?
        WHERE id = ?`,
    )
      .bind(paidUsdCents, Date.now(), orderId)
      .run();
  }
  await logEvent(env.DB, {
    type: 'invoice.paid',
    actorKind: 'stripe',
    actorId: inv.id,
    subjectKind: orderId ? 'order' : 'invoice',
    subjectId: orderId ?? ledgerId ?? inv.id,
    requestId,
    payload: { amountPaid: inv.amount_paid, currency: inv.currency },
  });
}

async function onInvoiceFailed(env: AppContext['Bindings'], event: StripeEvent, requestId: string) {
  const inv = event.data.object as unknown as InvoiceObj;
  await logEvent(env.DB, {
    type: 'invoice.payment_failed',
    actorKind: 'stripe',
    actorId: inv.id,
    subjectKind: 'invoice',
    subjectId: inv.metadata?.ledger_id ?? inv.id,
    requestId,
    payload: { amountDue: inv.amount_due, currency: inv.currency },
  });
}

interface ChargeObj {
  id: string;
  amount_refunded: number;
  payment_intent: string | null;
  currency: string;
}

async function onChargeRefunded(env: AppContext['Bindings'], event: StripeEvent, requestId: string) {
  const ch = event.data.object as unknown as ChargeObj;
  const order = ch.payment_intent
    ? await env.DB.prepare(
        `SELECT id, fx_rate, currency FROM orders WHERE stripe_payment_intent_id = ?`,
      )
        .bind(ch.payment_intent)
        .first<{ id: string; fx_rate: number; currency: string }>()
    : null;
  if (order) {
    // Stripe reports `amount_refunded` in presentment minor units; the
    // ledger column is canonical USD cents, so convert via the snapshotted
    // order fx_rate before persisting.
    const refundedUsdCents = presentmentToUsdCents(
      ch.amount_refunded,
      Number(order.fx_rate ?? 1),
      ch.currency || order.currency,
    );
    await env.DB.prepare(`UPDATE orders SET refunded_cents = ?, updated_at = ? WHERE id = ?`)
      .bind(refundedUsdCents, Date.now(), order.id)
      .run();
    await env.DB.prepare(
      `UPDATE refunds SET status = 'succeeded', updated_at = ? WHERE order_id = ? AND status = 'pending'`,
    )
      .bind(Date.now(), order.id)
      .run();
  }
  await logEvent(env.DB, {
    type: 'charge.refunded',
    actorKind: 'stripe',
    actorId: ch.id,
    subjectKind: order ? 'order' : 'charge',
    subjectId: order?.id ?? ch.id,
    requestId,
    payload: { amountRefunded: ch.amount_refunded, currency: ch.currency },
  });
}

async function onDisputeCreated(env: AppContext['Bindings'], event: StripeEvent, requestId: string) {
  const obj = event.data.object as unknown as { id: string; charge: string; amount: number; reason: string };
  await logEvent(env.DB, {
    type: 'charge.dispute_created',
    actorKind: 'stripe',
    actorId: obj.id,
    subjectKind: 'charge',
    subjectId: obj.charge,
    requestId,
    payload: { amount: obj.amount, reason: obj.reason },
  });
}
