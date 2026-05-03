import { Hono } from 'hono';
import type { AppContext } from '../env';
import { Errors } from '../lib/errors';
import { rateLimit } from '../middleware/rate-limit';
import { turnstile } from '../middleware/turnstile';
import { QuoteInput, createQuote, getQuoteById } from '../services/quotes';

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
    const quote = await createQuote(c.env, parsed.data, customer?.id ?? null, {
      requestId: c.get('requestId'),
      ip: c.get('ip'),
    });
    return c.json({ data: quote }, 201);
  },
);

quotes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const quote = await getQuoteById(c.env, id);
  if (!quote) throw Errors.notFound('Quote not found');
  const customer = c.get('customer');
  if (quote.customerId && quote.customerId !== customer?.id) throw Errors.forbidden();
  return c.json({ data: quote });
});
