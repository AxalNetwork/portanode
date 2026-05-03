import { z } from 'zod';
import type { Env } from '../env';
import { newQuoteId } from '../lib/ids';
import { Errors } from '../lib/errors';
import { logEvent } from '../db/events';
import { getConfiguration } from './configurations';

export const QuoteInput = z.object({
  configurationId: z.string().min(4).max(40),
  contact: z.object({
    email: z.string().email(),
    name: z.string().min(1).max(200).optional(),
    company: z.string().max(200).optional(),
    phone: z.string().max(40).optional(),
  }),
  notes: z.string().max(4000).optional(),
});
export type QuoteInputT = z.infer<typeof QuoteInput>;

const QUOTE_VALID_DAYS = 30;
const DEPOSIT_PCT = 0.3;

export async function createQuote(
  env: Env,
  input: QuoteInputT,
  customerId: string | null,
  reqMeta: { requestId: string; ip: string },
) {
  const cfg = await getConfiguration(env, input.configurationId);
  if (!cfg) throw Errors.badRequest('Unknown configuration');
  // Ownership guard: an owned config may only be quoted by its owner.
  // Anonymous configs (cfg.customerId === null) remain quoteable by anyone
  // with the id, mirroring the public GET /api/configurations/:id semantics.
  if (cfg.customerId && cfg.customerId !== customerId) throw Errors.forbidden();

  const subtotalCents = Math.round(cfg.totals.priceUsd * 100);
  const freightCents = estimateFreightCents(cfg.region, cfg.totals.weightKg);
  const taxCents = 0; // computed at checkout
  const totalCents = subtotalCents + freightCents + taxCents;
  const depositCents = Math.round(totalCents * DEPOSIT_PCT);

  const id = newQuoteId();
  const now = Date.now();
  const expiresAt = now + QUOTE_VALID_DAYS * 24 * 60 * 60 * 1000;

  await env.DB.prepare(
    `INSERT INTO quotes (
        id, customer_id, configuration_id, status, contact_email, contact_name,
        contact_company, contact_phone, region, currency, subtotal_cents,
        freight_cents, tax_cents, total_cents, deposit_cents, notes, expires_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, 'USD', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      customerId,
      cfg.id,
      input.contact.email,
      input.contact.name ?? null,
      input.contact.company ?? null,
      input.contact.phone ?? null,
      cfg.region,
      subtotalCents,
      freightCents,
      taxCents,
      totalCents,
      depositCents,
      input.notes ?? null,
      expiresAt,
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
    payload: { totalCents, depositCents, region: cfg.region },
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
    },
    region: String(r.region),
    currency: String(r.currency),
    subtotalCents: Number(r.subtotal_cents),
    freightCents: Number(r.freight_cents),
    taxCents: Number(r.tax_cents),
    totalCents: Number(r.total_cents),
    depositCents: Number(r.deposit_cents),
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
