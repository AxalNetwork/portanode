import { z } from 'zod';
import type { Env } from '../env';
import { newQuoteId } from '../lib/ids';
import { Errors } from '../lib/errors';
import { logEvent } from '../db/events';
import { getConfiguration, createConfiguration } from './configurations';
import { currencyForCountry, getFxTable, convertCentsByRate, formatMoney } from '../lib/fx';
import { signQuoteToken } from '../lib/quote-token';
import { validateVatId } from '../lib/vies';

// A `configuration` payload may be inlined when the configurator hasn't yet
// persisted to /api/configurations (the local stub keeps the id in
// localStorage); the worker creates the row server-side using the same
// Turnstile-validated request context before pricing the quote.
const InlineConfiguration = z.object({
  source: z.enum(['configurator', 'stack', 'admin']).default('configurator'),
  region: z.string().min(2).max(16),
  catalogVersion: z.string().min(1).max(32),
  payload: z.record(z.string(), z.unknown()),
  totals: z.object({
    priceUsd: z.number().nonnegative(),
    weightKg: z.number().nonnegative(),
    powerKw: z.number(),
    leadTimeWeeks: z.number().nonnegative(),
  }),
});

export const QuoteInput = z.object({
  configurationId: z.string().min(4).max(40).optional(),
  configuration: InlineConfiguration.optional(),
  contact: z.object({
    email: z.string().email(),
    name: z.string().min(1).max(200).optional(),
    company: z.string().min(1).max(200),
    phone: z.string().min(3).max(40),
    country: z.string().min(2).max(2).regex(/^[A-Za-z]{2}$/),
  }),
  deploymentSite: z.string().max(400).optional(),
  useCase: z.string().max(2000).optional(),
  vatId: z.string().max(32).optional(),
  expedite: z.boolean().optional(),
  customizations: z
    .object({
      summary: z.string().max(2000).optional(),
      feeUsd: z.number().nonnegative().max(500_000).optional(),
    })
    .optional(),
  notes: z.string().max(4000).optional(),
});
export type QuoteInputT = z.infer<typeof QuoteInput>;

const QUOTE_VALID_DAYS = 30;
const DEPOSIT_PCT = 0.2;
const EXPEDITE_PCT = 0.08;

export async function createQuote(
  env: Env,
  input: QuoteInputT,
  customerId: string | null,
  reqMeta: { requestId: string; ip: string; cfCountry?: string | null },
) {
  // Resolve the configuration: prefer an existing id (already persisted via
  // /api/configurations) but accept an inline payload as a fallback so the
  // formal-quote CTA can succeed even when the configurator's local-only
  // save stub never made it to D1. Both paths require Turnstile (enforced
  // upstream on /api/quotes).
  let cfg = input.configurationId ? await getConfiguration(env, input.configurationId) : null;
  if (!cfg && input.configuration) {
    cfg = await createConfiguration(env, input.configuration, customerId, {
      requestId: reqMeta.requestId,
      ip: reqMeta.ip,
    });
  }
  if (!cfg) throw Errors.badRequest('Unknown configuration');
  if (cfg.customerId && cfg.customerId !== customerId) throw Errors.forbidden();

  const country = input.contact.country.toUpperCase();
  const currency = currencyForCountry(country);
  const fx = await getFxTable(env);
  const fxRate = currency === 'USD' ? 1 : (fx.rates[currency] ?? 1);

  const subtotalCents = Math.round(cfg.totals.priceUsd * 100);
  const freightCents = estimateFreightCents(cfg.region, cfg.totals.weightKg);
  const customizationFeeCents =
    input.customizations?.feeUsd != null ? Math.round(input.customizations.feeUsd * 100) : 0;
  const expediteFeeCents = input.expedite ? Math.round(subtotalCents * EXPEDITE_PCT) : 0;
  const totalCents = subtotalCents + freightCents + customizationFeeCents + expediteFeeCents;
  const depositCents = Math.round(totalCents * DEPOSIT_PCT);

  let vatValidatedAt: number | null = null;
  let vatCountry: string | null = null;
  if (input.vatId) {
    const vies = await validateVatId(input.vatId);
    if (vies?.valid) {
      vatValidatedAt = vies.validatedAt;
      vatCountry = vies.country;
    }
  }

  const id = newQuoteId();
  const now = Date.now();
  const expiresAt = now + QUOTE_VALID_DAYS * 24 * 60 * 60 * 1000;

  await env.DB.prepare(
    `INSERT INTO quotes (
        id, customer_id, configuration_id, status, contact_email, contact_name,
        contact_company, contact_phone, contact_country, deployment_site, use_case,
        region, currency, subtotal_cents, freight_cents, tax_cents, total_cents,
        deposit_cents, customization_fee_cents, expedite_fee_cents, fx_rate,
        vat_id, vat_validated_at, vat_country, notes, expires_at, sent_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, 'sent', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      customerId,
      cfg.id,
      input.contact.email,
      input.contact.name ?? null,
      input.contact.company,
      input.contact.phone,
      country,
      input.deploymentSite ?? null,
      input.useCase ?? null,
      cfg.region,
      currency,
      subtotalCents,
      freightCents,
      totalCents,
      depositCents,
      customizationFeeCents,
      expediteFeeCents,
      fxRate,
      input.vatId ?? null,
      vatValidatedAt,
      vatCountry,
      input.notes ?? null,
      expiresAt,
      now,
      now,
      now,
    )
    .run();

  await logEvent(env.DB, {
    type: 'quote.created',
    actorKind: customerId ? 'customer' : 'system',
    actorId: customerId,
    subjectKind: 'quote',
    subjectId: id,
    requestId: reqMeta.requestId,
    ip: reqMeta.ip,
    payload: { totalCents, depositCents, region: cfg.region, currency, country },
  });

  return getQuoteById(env, id);
}

export async function getQuoteById(env: Env, id: string) {
  const row = await env.DB.prepare(`SELECT * FROM quotes WHERE id = ?`).bind(id).first();
  return row ? hydrateQuote(row as Record<string, unknown>) : null;
}

export async function listQuotesForCustomer(env: Env, customerId: string) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM quotes WHERE customer_id = ? ORDER BY created_at DESC LIMIT 100`,
  )
    .bind(customerId)
    .all();
  return (results ?? []).map((r) => hydrateQuote(r as Record<string, unknown>));
}

export async function listQuotesAdmin(env: Env, status?: string, limit = 100) {
  const sql = status
    ? `SELECT * FROM quotes WHERE status = ? ORDER BY created_at DESC LIMIT ?`
    : `SELECT * FROM quotes ORDER BY created_at DESC LIMIT ?`;
  const stmt = status ? env.DB.prepare(sql).bind(status, limit) : env.DB.prepare(sql).bind(limit);
  const { results } = await stmt.all();
  return (results ?? []).map((r) => hydrateQuote(r as Record<string, unknown>));
}

export async function markQuoteAccepted(
  env: Env,
  id: string,
  meta: { stripeCheckoutId: string | null; stripePaymentIntentId: string | null },
) {
  const now = Date.now();
  await env.DB.prepare(
    `UPDATE quotes
       SET status = 'accepted', accepted_at = ?,
           stripe_checkout_id = COALESCE(?, stripe_checkout_id),
           stripe_payment_intent_id = COALESCE(?, stripe_payment_intent_id),
           updated_at = ?
     WHERE id = ?`,
  )
    .bind(now, meta.stripeCheckoutId, meta.stripePaymentIntentId, now, id)
    .run();
}

export async function setQuoteCheckout(
  env: Env,
  id: string,
  stripeCheckoutId: string,
) {
  await env.DB.prepare(
    `UPDATE quotes SET stripe_checkout_id = ?, updated_at = ? WHERE id = ?`,
  )
    .bind(stripeCheckoutId, Date.now(), id)
    .run();
}

export async function setQuotePdfKey(env: Env, id: string, key: string) {
  await env.DB.prepare(`UPDATE quotes SET pdf_r2_key = ?, updated_at = ? WHERE id = ?`)
    .bind(key, Date.now(), id)
    .run();
}

export async function buildSignedQuoteUrl(env: Env, q: HydratedQuote): Promise<string> {
  const token = await signQuoteToken(env, q.id, q.expiresAt);
  return `${env.APP_BASE_URL}/quote/${encodeURIComponent(q.id)}/?t=${encodeURIComponent(token)}`;
}

export async function buildSignedQuoteToken(env: Env, q: HydratedQuote): Promise<string> {
  return signQuoteToken(env, q.id, q.expiresAt);
}

export async function buildQuoteEmailVars(env: Env, q: HydratedQuote) {
  // Always use the rate snapshotted on the quote so the email matches the
  // PDF, the quote page, and Stripe Checkout exactly — even days later.
  const totalLocal = convertCentsByRate(q.totalCents, q.fxRate, q.currency);
  const depositLocal = convertCentsByRate(q.depositCents, q.fxRate, q.currency);
  return {
    quoteId: q.id,
    totalDisplay: formatMoney(totalLocal, q.currency),
    depositDisplay: formatMoney(depositLocal, q.currency),
    expiresOn: new Date(q.expiresAt).toISOString().slice(0, 10),
    quoteUrl: await buildSignedQuoteUrl(env, q),
  };
}

export type HydratedQuote = ReturnType<typeof hydrateQuote>;

function hydrateQuote(r: Record<string, unknown>) {
  return {
    id: String(r.id),
    customerId: r.customer_id as string | null,
    configurationId: String(r.configuration_id),
    status: String(r.status),
    contact: {
      email: String(r.contact_email),
      name: r.contact_name as string | null,
      company: r.contact_company as string | null,
      phone: r.contact_phone as string | null,
      country: (r.contact_country as string | null) ?? null,
    },
    deploymentSite: (r.deployment_site as string | null) ?? null,
    useCase: (r.use_case as string | null) ?? null,
    region: String(r.region),
    currency: String(r.currency),
    subtotalCents: Number(r.subtotal_cents),
    freightCents: Number(r.freight_cents),
    customizationFeeCents: Number(r.customization_fee_cents ?? 0),
    expediteFeeCents: Number(r.expedite_fee_cents ?? 0),
    taxCents: Number(r.tax_cents),
    totalCents: Number(r.total_cents),
    depositCents: Number(r.deposit_cents),
    fxRate: Number(r.fx_rate ?? 1),
    vatId: (r.vat_id as string | null) ?? null,
    vatValidatedAt: r.vat_validated_at ? Number(r.vat_validated_at) : null,
    vatCountry: (r.vat_country as string | null) ?? null,
    stripeCheckoutId: (r.stripe_checkout_id as string | null) ?? null,
    stripePaymentIntentId: (r.stripe_payment_intent_id as string | null) ?? null,
    notes: r.notes as string | null,
    pdfR2Key: r.pdf_r2_key as string | null,
    expiresAt: Number(r.expires_at),
    sentAt: r.sent_at ? Number(r.sent_at) : null,
    acceptedAt: r.accepted_at ? Number(r.accepted_at) : null,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

/** Coarse freight estimate by region tier and weight. Refined later by ops. */
function estimateFreightCents(region: string, weightKg: number): number {
  const tier =
    region === 'na' || region === 'eu' ? 1 :
    region === 'ssa' || region === 'polar' ? 3 : 2;
  const perKg = tier === 1 ? 80 : tier === 2 ? 140 : 220; // cents/kg
  const base = tier === 1 ? 250000 : tier === 2 ? 420000 : 680000;
  return base + Math.round(weightKg * perKg);
}
