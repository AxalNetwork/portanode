import { Hono } from 'hono';
import type { AppContext } from '../env';
import { Errors } from '../lib/errors';
import { requireCustomer } from '../middleware/auth';
import {
  OrderNoteInput,
  addOrderNoteCustomer,
  getInvoiceForCustomer,
  getOrderForCustomer,
  listOrdersForCustomer,
} from '../services/orders';
import {
  buildSignedQuoteToken,
  getQuoteById,
  listQuotesForCustomer,
  setQuoteCheckout,
} from '../services/quotes';
import { getOrRenderQuotePdf } from '../services/quote-pdf';
import {
  ConfigurationInput,
  createConfiguration,
  getConfiguration,
} from '../services/configurations';
import {
  ProfilePatch,
  buildDataExport,
  getProfile,
  listConfigurationsForCustomer,
  recordPrivacyRequest,
  updateProfile,
} from '../services/customers';
import { createCheckoutSession } from '../stripe/checkout';
import { logEvent } from '../db/events';

export const account = new Hono<AppContext>();
account.use('*', requireCustomer);

// ── Dashboard / orders ──────────────────────────────────────────────────────

account.get('/orders', async (c) => {
  const customer = c.get('customer')!;
  const data = await listOrdersForCustomer(c.env, customer.id);
  return c.json({ data });
});

account.get('/orders/:id', async (c) => {
  const customer = c.get('customer')!;
  const order = await getOrderForCustomer(c.env, customer.id, c.req.param('id'));
  if (!order) throw Errors.notFound('Order not found');
  const { results: notes } = await c.env.DB.prepare(
    `SELECT id, author_kind, body, created_at FROM order_notes WHERE order_id = ? ORDER BY created_at ASC`,
  )
    .bind(order.id)
    .all();
  const { results: invoices } = await c.env.DB.prepare(
    `SELECT id, kind, amount_cents, currency, issued_at, paid_at, pdf_r2_key
       FROM invoices WHERE order_id = ? ORDER BY issued_at ASC`,
  )
    .bind(order.id)
    .all();
  // Decorate invoices with a portal-served download URL so the SPA can render
  // a stable link without leaking the raw R2 key. The endpoint streams the
  // PDF only after a fresh ownership check.
  const invoicesOut = (invoices ?? []).map((row: Record<string, unknown>) => ({
    id: String(row.id),
    kind: String(row.kind),
    amount_cents: Number(row.amount_cents),
    currency: String(row.currency),
    issued_at: Number(row.issued_at),
    paid_at: row.paid_at ? Number(row.paid_at) : null,
    pdfUrl: row.pdf_r2_key ? `/api/account/invoices/${encodeURIComponent(String(row.id))}/pdf` : null,
  }));
  // Spec sheet PDF — the order's source quote PDF. Only surfaced if the order
  // was raised from a quote (legacy direct orders won't have one).
  const specPdfUrl = order.quoteId
    ? `/api/account/orders/${encodeURIComponent(order.id)}/spec.pdf`
    : null;
  return c.json({
    data: { order, notes: notes ?? [], invoices: invoicesOut, specPdfUrl },
  });
});

/** Streams the spec sheet PDF (sourced from the order's quote) after a fresh
 *  ownership check. Reuses getOrRenderQuotePdf so we don't re-implement the
 *  Browser-Rendering pipeline. Falls back to HTML when the binding is absent. */
account.get('/orders/:id/spec.pdf', async (c) => {
  const customer = c.get('customer')!;
  const order = await getOrderForCustomer(c.env, customer.id, c.req.param('id'));
  if (!order || !order.quoteId) throw Errors.notFound('Spec sheet not available');
  const quote = await getQuoteById(c.env, order.quoteId);
  if (!quote || quote.customerId !== customer.id) throw Errors.notFound('Spec sheet not available');
  const out = await getOrRenderQuotePdf(c.env, quote);
  if (out.kind === 'pdf') {
    return new Response(out.bytes, {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `inline; filename="AXAL-${order.id}-spec.pdf"`,
        'cache-control': 'private, max-age=3600',
      },
    });
  }
  return new Response(out.html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
});

/** Streams an invoice PDF from R2 after ownership + R2-key checks. */
account.get('/invoices/:id/pdf', async (c) => {
  const customer = c.get('customer')!;
  const invoice = await getInvoiceForCustomer(c.env, customer.id, c.req.param('id'));
  if (!invoice || !invoice.pdfR2Key) throw Errors.notFound('Invoice PDF not available');
  const obj = await c.env.ASSETS.get(invoice.pdfR2Key);
  if (!obj) throw Errors.notFound('Invoice PDF not available');
  return new Response(obj.body, {
    status: 200,
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="AXAL-invoice-${invoice.id}.pdf"`,
      'cache-control': 'private, max-age=3600',
    },
  });
});

account.post('/orders/:id/notes', async (c) => {
  const customer = c.get('customer')!;
  const body = await c.req.json().catch(() => null);
  const parsed = OrderNoteInput.safeParse(body);
  if (!parsed.success) throw Errors.invalid(parsed.error.flatten());
  const note = await addOrderNoteCustomer(c.env, c.req.param('id'), customer.id, parsed.data.body, {
    requestId: c.get('requestId'),
    ip: c.get('ip'),
  });
  return c.json({ data: note }, 201);
});

// ── Quotes ──────────────────────────────────────────────────────────────────

account.get('/quotes', async (c) => {
  const customer = c.get('customer')!;
  const data = await listQuotesForCustomer(c.env, customer.id);
  return c.json({ data });
});

account.get('/quotes/:id', async (c) => {
  const customer = c.get('customer')!;
  const quote = await getQuoteById(c.env, c.req.param('id'));
  if (!quote || quote.customerId !== customer.id) throw Errors.notFound('Quote not found');
  return c.json({ data: quote });
});

/** Customer-authenticated checkout: reuses the same Stripe Checkout session
 *  builder as the public quote-token flow. No token is required here because
 *  the session cookie + CSRF already proved ownership. */
account.post('/quotes/:id/checkout', async (c) => {
  const customer = c.get('customer')!;
  const quote = await getQuoteById(c.env, c.req.param('id'));
  if (!quote || quote.customerId !== customer.id) throw Errors.notFound('Quote not found');
  if (quote.status === 'expired' || quote.expiresAt < Date.now()) {
    throw Errors.badRequest('Quote has expired');
  }
  if (quote.status === 'cancelled') throw Errors.badRequest('Quote is cancelled');
  const token = await buildSignedQuoteToken(c.env, quote);
  const session = await createCheckoutSession(
    c.env,
    {
      id: quote.id,
      configurationId: quote.configurationId,
      customerId: quote.customerId,
      contact: { email: quote.contact.email, name: quote.contact.name, company: quote.contact.company },
      region: quote.region,
      currency: quote.currency,
      fxRate: quote.fxRate,
      subtotalCents: quote.subtotalCents,
      freightCents: quote.freightCents,
      customizationFeeCents: quote.customizationFeeCents,
      expediteFeeCents: quote.expediteFeeCents,
      depositCents: quote.depositCents,
      totalCents: quote.totalCents,
      vatId: quote.vatId,
      vatCountry: quote.vatCountry,
    },
    token,
  );
  await setQuoteCheckout(c.env, quote.id, session.id);
  await logEvent(c.env.DB, {
    type: 'quote.checkout_started',
    actorKind: 'customer',
    actorId: customer.id,
    subjectKind: 'quote',
    subjectId: quote.id,
    requestId: c.get('requestId'),
    ip: c.get('ip'),
    payload: { sessionId: session.id, currency: session.currency, amount: session.amount_total, source: 'portal' },
  });
  return c.json({ data: { url: session.url, sessionId: session.id } });
});

// ── Invoices ────────────────────────────────────────────────────────────────

account.get('/invoices/:id', async (c) => {
  const customer = c.get('customer')!;
  const invoice = await getInvoiceForCustomer(c.env, customer.id, c.req.param('id'));
  if (!invoice) throw Errors.notFound('Invoice not found');
  return c.json({ data: invoice });
});

// ── Saved configurations ────────────────────────────────────────────────────

account.get('/configurations', async (c) => {
  const customer = c.get('customer')!;
  const data = await listConfigurationsForCustomer(c.env, customer.id);
  return c.json({ data });
});

account.post('/configurations/:id/duplicate', async (c) => {
  const customer = c.get('customer')!;
  const src = await getConfiguration(c.env, c.req.param('id'));
  if (!src || (src.customerId && src.customerId !== customer.id)) {
    throw Errors.notFound('Configuration not found');
  }
  const parsed = ConfigurationInput.safeParse({
    source: src.source,
    region: src.region,
    payload: src.payload,
    totals: src.totals,
    catalogVersion: src.catalogVersion,
  });
  if (!parsed.success) throw Errors.invalid(parsed.error.flatten());
  const row = await createConfiguration(c.env, parsed.data, customer.id, {
    requestId: c.get('requestId'),
    ip: c.get('ip'),
  });
  return c.json({ data: row }, 201);
});

// ── Profile ────────────────────────────────────────────────────────────────

account.get('/profile', async (c) => {
  const customer = c.get('customer')!;
  const profile = await getProfile(c.env, customer.id);
  return c.json({ data: profile });
});

account.patch('/profile', async (c) => {
  const customer = c.get('customer')!;
  const body = await c.req.json().catch(() => null);
  const parsed = ProfilePatch.safeParse(body);
  if (!parsed.success) throw Errors.invalid(parsed.error.flatten());
  const profile = await updateProfile(c.env, customer.id, parsed.data, {
    requestId: c.get('requestId'),
    ip: c.get('ip'),
  });
  return c.json({ data: profile });
});

// ── Privacy self-service ────────────────────────────────────────────────────

/** Right-to-access: returns the customer's full data export inline (JSON).
 *  POST so the response isn't accidentally cached, and so it requires CSRF. */
account.post('/export', async (c) => {
  const customer = c.get('customer')!;
  await recordPrivacyRequest(c.env, customer.id, 'export', null, {
    requestId: c.get('requestId'),
    ip: c.get('ip'),
  });
  const data = await buildDataExport(c.env, customer.id);
  return new Response(JSON.stringify(data, null, 2), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="axal-data-export-${customer.id}.json"`,
      'cache-control': 'no-store',
    },
  });
});

/** Right-to-erasure: queues the request. We don't synchronously hard-delete
 *  because of order/invoice retention obligations; ops processes within 30
 *  days, scrubbing PII and replacing the email with a tombstone. */
account.post('/delete', async (c) => {
  const customer = c.get('customer')!;
  const body = await c.req.json().catch(() => ({}));
  const notes = typeof body?.reason === 'string' ? String(body.reason).slice(0, 1000) : null;
  const data = await recordPrivacyRequest(c.env, customer.id, 'delete', notes, {
    requestId: c.get('requestId'),
    ip: c.get('ip'),
  });
  return c.json({ data }, 202);
});
