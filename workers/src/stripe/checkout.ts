/**
 * Stripe Checkout Session creation for the deposit payment.
 *
 * Line-item composition (each line is FX-converted from canonical USD into
 * the resolved presentment currency, then split as integer minor units):
 *   1. "Reservation deposit (modules)" — 20% of subtotal + expedite
 *   2. "Customization fee"             — 100% of customization (only if > 0)
 *   3. "Shipping & freight reservation"— 100% of freight (only if > 0)
 *
 * The three lines together sum to the quote.depositCents (20% of total) so
 * the customer pays the standard 20% deposit while seeing an itemized
 * breakdown that mirrors the quote PDF.
 *
 * Idempotency: each Checkout Session is keyed by quote id + version so
 * repeated POSTs collapse on Stripe's side.
 */
import type { Env } from '../env';
import { stripeRequest } from './client';
import { convertCentsByRate, formatMoney } from '../lib/fx';

export interface QuoteForCheckout {
  id: string;
  configurationId: string;
  customerId: string | null;
  contact: { email: string; name: string | null; company: string | null };
  region: string;
  currency: string;
  fxRate: number;
  subtotalCents: number;        // USD
  freightCents: number;         // USD
  customizationFeeCents: number;
  expediteFeeCents: number;
  depositCents: number;         // USD (20% of total)
  totalCents: number;           // USD (subtotal + freight + customization + expedite)
  vatId: string | null;
  vatCountry: string | null;
}

export interface CheckoutSession {
  id: string;
  url: string;
  payment_intent: string | null;
  amount_total: number;
  currency: string;
}

const DEPOSIT_PCT = 0.2;

interface SplitLine {
  name: string;
  description: string;
  kind: 'deposit' | 'customization' | 'shipping';
  amountCents: number; // resolved currency, minor units
}

/**
 * Allocate the 20% deposit across three line items so the customer sees an
 * itemized breakdown that mirrors the quote PDF. Each component pays its
 * own 20% share of the corresponding quoted amount; the third line absorbs
 * the rounding remainder so the three lines sum exactly to
 * `quote.depositCents` (= 20% of total). All math runs in USD cents first
 * for FX stability and is then converted per line into the presentment
 * currency.
 */
export function buildLines(quote: QuoteForCheckout): SplitLine[] {
  const equipmentBaseUsd = quote.subtotalCents + quote.expediteFeeCents;
  const depositOnEquipUsd = Math.round(equipmentBaseUsd * DEPOSIT_PCT);
  const depositOnCustomUsd = Math.round(quote.customizationFeeCents * DEPOSIT_PCT);
  // Last line absorbs cumulative rounding so the three lines sum exactly to
  // depositCents in USD. Mathematically non-negative because depositCents =
  // round(0.2 * total) and the first two are floors of their components — any
  // residual can only be ±1¢ from round(0.2*freight), which is non-negative.
  const depositOnShippingUsd = Math.max(
    0,
    quote.depositCents - depositOnEquipUsd - depositOnCustomUsd,
  );

  // Use the rate snapshotted on the quote so the customer-visible totals on
  // the quote page, the PDF, the email, and Stripe Checkout all match exactly.
  const toLocal = (usdCents: number) => convertCentsByRate(usdCents, quote.fxRate, quote.currency);

  const lines: SplitLine[] = [
    {
      name: 'Reservation deposit (20% of equipment)',
      description: `Secures your manufacturing slot for quote ${quote.id}. Equipment subtotal in USD: ${formatMoney(
        equipmentBaseUsd,
        'USD',
      )}; remaining 80% invoiced after production scheduling.`,
      kind: 'deposit',
      amountCents: toLocal(depositOnEquipUsd),
    },
  ];
  if (depositOnCustomUsd > 0) {
    lines.push({
      name: 'Customization deposit (20%)',
      description: 'Deposit toward bespoke customization work as quoted.',
      kind: 'customization',
      amountCents: toLocal(depositOnCustomUsd),
    });
  }
  if (depositOnShippingUsd > 0) {
    lines.push({
      name: 'Shipping & freight deposit (20%)',
      description: `Deposit toward freight to region ${quote.region.toUpperCase()}.`,
      kind: 'shipping',
      amountCents: toLocal(depositOnShippingUsd),
    });
  }
  return lines;
}

export async function createCheckoutSession(
  env: Env,
  quote: QuoteForCheckout,
  signedToken: string,
): Promise<CheckoutSession> {
  const currency = quote.currency.toLowerCase();
  const lines = buildLines(quote);

  // Success goes through a worker route that resolves the Stripe session id
  // back to our internal order id, so the customer lands on the proper
  // /account/orders/:id?success=1 page even though Stripe only knows the
  // {CHECKOUT_SESSION_ID} placeholder.
  const success_url = `${env.API_BASE_URL}/api/stripe/return?session_id={CHECKOUT_SESSION_ID}`;
  // Cancel keeps the signed token so the customer's quote link remains valid
  // after returning to /quote/{id}/.
  const cancel_url = `${env.APP_BASE_URL}/quote/${encodeURIComponent(quote.id)}/?t=${encodeURIComponent(
    signedToken,
  )}&cancelled=1`;

  const params: Record<string, unknown> = {
    mode: 'payment',
    ui_mode: 'hosted',
    locale: 'auto',
    customer_email: quote.contact.email,
    success_url,
    cancel_url,
    payment_method_types: paymentMethodsForCurrency(quote.currency),
    billing_address_collection: 'required',
    shipping_address_collection: { allowed_countries: SHIPPING_COUNTRIES },
    phone_number_collection: { enabled: true },
    automatic_tax: { enabled: true },
    tax_id_collection: { enabled: true },
    payment_intent_data: {
      capture_method: 'automatic',
      description: `AXAL deposit for ${quote.id}`,
      // 3DS/SCA is on by default for card; request automatic where supported.
      setup_future_usage: undefined,
      metadata: {
        quote_id: quote.id,
        configuration_id: quote.configurationId,
      },
    },
    metadata: {
      quote_id: quote.id,
      configuration_id: quote.configurationId,
      region: quote.region,
      customer_id: quote.customerId ?? '',
      deposit_usd_cents: String(quote.depositCents),
      total_usd_cents: String(quote.totalCents),
      fx_rate: String(quote.fxRate),
    },
    line_items: lines.map((l) => ({
      quantity: 1,
      price_data: {
        currency,
        unit_amount: l.amountCents,
        product_data: {
          name: l.name,
          description: l.description,
          metadata: { kind: l.kind, quote_id: quote.id },
        },
        tax_behavior: 'exclusive',
      },
    })),
  };

  const idempotencyKey = `axal:quote:${quote.id}:checkout:v2`;

  const session = await stripeRequest<CheckoutSession & { payment_intent?: string | null }>(
    env,
    '/v1/checkout/sessions',
    params,
    { idempotencyKey },
  );

  return {
    id: session.id,
    url: session.url,
    payment_intent: session.payment_intent ?? null,
    amount_total: session.amount_total,
    currency: session.currency,
  };
}

/** Stripe payment methods enabled per currency. Cards are universal; we add
 *  ACH for USD, SEPA for EUR, and the bank-transfer / customer-balance method
 *  where Stripe supports it. */
function paymentMethodsForCurrency(currency: string): string[] {
  const c = currency.toUpperCase();
  const methods = ['card'];
  if (c === 'USD') methods.push('us_bank_account');
  if (c === 'EUR') methods.push('sepa_debit');
  if (['USD', 'EUR', 'GBP', 'JPY', 'MXN'].includes(c)) methods.push('customer_balance');
  return methods;
}

/** A conservative shipping country allowlist matching AXAL's regional service.
 *  Wildcards aren't supported by Stripe Checkout — list explicit ISO codes. */
const SHIPPING_COUNTRIES: string[] = [
  // North America
  'US','CA','MX',
  // Europe
  'GB','IE','FR','DE','ES','IT','NL','BE','PT','AT','FI','GR','SE','NO','DK','CH','PL','CZ','RO','HU',
  // LATAM
  'BR','AR','CL','CO','PE','UY',
  // MENA
  'AE','SA','EG','MA','QA','KW',
  // SSA
  'ZA','NG','KE','GH','SN','TZ',
  // APAC
  'AU','NZ','JP','SG','HK','KR','IN','MY','TH','PH','ID','VN','TW',
];

export function describeDepositForEmail(quote: QuoteForCheckout): string {
  const local =
    quote.currency === 'USD'
      ? formatMoney(quote.depositCents, 'USD')
      : `${formatMoney(
          convertCentsByRate(quote.depositCents, quote.fxRate, quote.currency),
          quote.currency,
        )} (≈ ${formatMoney(quote.depositCents, 'USD')})`;
  return local;
}
