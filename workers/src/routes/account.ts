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
import { listQuotesForCustomer } from '../services/quotes';

export const account = new Hono<AppContext>();
account.use('*', requireCustomer);

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
    `SELECT id, kind, amount_cents, currency, issued_at, paid_at FROM invoices WHERE order_id = ? ORDER BY issued_at ASC`,
  )
    .bind(order.id)
    .all();
  return c.json({ data: { order, notes: notes ?? [], invoices: invoices ?? [] } });
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

account.get('/quotes', async (c) => {
  const customer = c.get('customer')!;
  const data = await listQuotesForCustomer(c.env, customer.id);
  return c.json({ data });
});

account.get('/invoices/:id', async (c) => {
  const customer = c.get('customer')!;
  const invoice = await getInvoiceForCustomer(c.env, customer.id, c.req.param('id'));
  if (!invoice) throw Errors.notFound('Invoice not found');
  return c.json({ data: invoice });
});
