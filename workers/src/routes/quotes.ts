import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppContext } from '../env';
import { Errors } from '../lib/errors';
import { rateLimit } from '../middleware/rate-limit';
import { turnstile } from '../middleware/turnstile';
import {
  QuoteInput,
  buildQuoteEmailVars,
  buildSignedQuoteUrl,
  buildSignedQuoteToken,
  createQuote,
  getQuoteById,
  setQuoteCheckout,
  setQuotePdfKey,
} from '../services/quotes';
import { sendEmail } from '../email/send';
import { verifyQuoteToken } from '../lib/quote-token';
import { createCheckoutSession } from '../stripe/checkout';
import { getOrRenderQuotePdf } from '../services/quote-pdf';
import { logEvent } from '../db/events';

export const quotes = new Hono<AppContext>();

quotes.post(
  '/',
  rateLimit((env) => env.RL_CONFIG),
  turnstile,
  async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = QuoteInput.safeParse(body);
    if (!parsed.success) throw Errors.invalid(parsed.error.flatten());
    const customer = c.get('customer');
    const cf = (c.req.raw as unknown as { cf?: { country?: string } }).cf;
    const quote = await createQuote(c.env, parsed.data, customer?.id ?? null, {
      requestId: c.get('requestId'),
      ip: c.get('ip'),
      cfCountry: cf?.country ?? null,
    });
    if (!quote) throw Errors.internal('Quote not persisted');

    // Send the quote email with a signed link valid for 30 days.
    const vars = await buildQuoteEmailVars(c.env, quote);
    await sendEmail(
      c.env,
      {
        to: quote.contact.email,
        template: 'quote-sent',
        subject: `Your AXAL quote ${quote.id}`,
        vars,
      },
      {
        requestId: c.get('requestId'),
        subjectKind: 'quote',
        subjectId: quote.id,
        actorId: customer?.id ?? null,
      },
    );
    return c.json({ data: { ...quote, url: vars.quoteUrl } }, 201);
  },
);

quotes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const quote = await getQuoteById(c.env, id);
  if (!quote) throw Errors.notFound('Quote not found');

  // Authorization: allow if (a) signed token matches, or (b) the quote is
  // owned by the current authenticated customer, or (c) the quote is
  // unowned (legacy/anonymous) — same posture as configurations.
  await authorizeQuoteRead(c, quote);
  return c.json({ data: quote });
});

quotes.get('/:id/pdf', async (c) => {
  const id = c.req.param('id');
  const quote = await getQuoteById(c.env, id);
  if (!quote) throw Errors.notFound('Quote not found');
  await authorizeQuoteRead(c, quote);
  const out = await getOrRenderQuotePdf(c.env, quote);
  if (out.kind === 'pdf') {
    if (!quote.pdfR2Key) await setQuotePdfKey(c.env, quote.id, `quotes/${quote.id}.pdf`);
    return new Response(out.bytes, {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `inline; filename="AXAL-${quote.id}.pdf"`,
        'cache-control': 'private, max-age=3600',
      },
    });
  }
  return new Response(out.html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
});

quotes.post('/:id/checkout', async (c) => {
  const id = c.req.param('id');
  const quote = await getQuoteById(c.env, id);
  if (!quote) throw Errors.notFound('Quote not found');
  await authorizeQuoteRead(c, quote);
  if (quote.status === 'expired' || quote.expiresAt < Date.now()) {
    throw Errors.badRequest('Quote has expired');
  }
  if (quote.status === 'cancelled') throw Errors.badRequest('Quote is cancelled');

  // Reuse the caller's token if it was signed by us; otherwise mint a fresh
  // one so the cancel_url stays valid for the rest of the quote's lifetime.
  const incoming = c.req.query('t') ?? c.req.query('token') ?? '';
  const token =
    incoming && (await verifyQuoteToken(c.env, incoming))
      ? incoming
      : await buildSignedQuoteToken(c.env, quote);
  const session = await createCheckoutSession(
    c.env,
    {
      id: quote.id,
      configurationId: quote.configurationId,
      customerId: quote.customerId,
      contact: {
        email: quote.contact.email,
        name: quote.contact.name,
        company: quote.contact.company,
      },
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
    actorKind: c.get('customer') ? 'customer' : 'system',
    actorId: c.get('customer')?.id ?? null,
    subjectKind: 'quote',
    subjectId: quote.id,
    requestId: c.get('requestId'),
    ip: c.get('ip'),
    payload: { sessionId: session.id, currency: session.currency, amount: session.amount_total },
  });
  return c.json({ data: { url: session.url, sessionId: session.id } });
});

async function authorizeQuoteRead(
  c: Context<AppContext>,
  quote: NonNullable<Awaited<ReturnType<typeof getQuoteById>>>,
): Promise<void> {
  const tokenParam = c.req.query('t') ?? c.req.query('token') ?? '';
  if (tokenParam) {
    const verified = await verifyQuoteToken(c.env, tokenParam);
    if (verified && verified.quoteId === quote.id) return;
    throw Errors.forbidden('Invalid or expired quote link');
  }
  const customer = c.get('customer');
  if (quote.customerId && quote.customerId !== customer?.id) throw Errors.forbidden();
  if (!quote.customerId) {
    // No token + no ownership → require token.
    throw Errors.forbidden('Quote link required');
  }
}

// Re-export helper for convenience.
export { buildSignedQuoteUrl };
