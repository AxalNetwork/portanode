/**
 * Stripe Invoices API helpers for the manual balance-billing step.
 * Flow: ensure customer → create invoice item → create + finalize invoice →
 * (optionally) send. The admin endpoint records our internal invoices.id and
 * uses it as the idempotency key.
 */
import type { Env } from '../env';
import { stripeRequest } from './client';

export interface EnsureCustomerArgs {
  email: string;
  name?: string | null;
  company?: string | null;
  phone?: string | null;
  existingId?: string | null;
}

interface StripeCustomer {
  id: string;
  email: string;
}

export async function ensureCustomer(env: Env, args: EnsureCustomerArgs): Promise<StripeCustomer> {
  if (args.existingId) {
    return stripeRequest<StripeCustomer>(env, `/v1/customers/${encodeURIComponent(args.existingId)}`);
  }
  return stripeRequest<StripeCustomer>(
    env,
    '/v1/customers',
    {
      email: args.email,
      name: args.name ?? args.company ?? undefined,
      description: args.company ?? undefined,
      phone: args.phone ?? undefined,
    },
    { idempotencyKey: `axal:customer:${args.email}` },
  );
}

export interface CreateBalanceInvoiceArgs {
  customerId: string;
  orderId: string;
  invoiceLedgerId: string;
  amountCents: number;
  currency: string;
  description: string;
  daysUntilDue?: number;
  vatId?: string | null;
}

export interface StripeInvoice {
  id: string;
  status: string;
  hosted_invoice_url: string | null;
  invoice_pdf: string | null;
  amount_due: number;
  currency: string;
}

export async function createBalanceInvoice(
  env: Env,
  args: CreateBalanceInvoiceArgs,
): Promise<StripeInvoice> {
  const idempotencyBase = `axal:invoice:${args.invoiceLedgerId}`;

  await stripeRequest(
    env,
    '/v1/invoiceitems',
    {
      customer: args.customerId,
      amount: args.amountCents,
      currency: args.currency.toLowerCase(),
      description: args.description,
      metadata: { order_id: args.orderId, ledger_id: args.invoiceLedgerId },
    },
    { idempotencyKey: `${idempotencyBase}:item` },
  );

  const invoice = await stripeRequest<StripeInvoice>(
    env,
    '/v1/invoices',
    {
      customer: args.customerId,
      collection_method: 'send_invoice',
      days_until_due: args.daysUntilDue ?? 14,
      auto_advance: true,
      automatic_tax: { enabled: true },
      metadata: { order_id: args.orderId, ledger_id: args.invoiceLedgerId },
    },
    { idempotencyKey: `${idempotencyBase}:invoice` },
  );

  // Finalize so a hosted invoice URL + PDF become available.
  return stripeRequest<StripeInvoice>(
    env,
    `/v1/invoices/${encodeURIComponent(invoice.id)}/finalize`,
    {},
    { idempotencyKey: `${idempotencyBase}:finalize` },
  );
}
