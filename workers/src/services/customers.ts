import { z } from 'zod';
import type { Env } from '../env';
import { Errors } from '../lib/errors';
import { logEvent } from '../db/events';
import { newShortId } from '../lib/ids';
import { stripeRequest } from '../stripe/client';

const Address = z.object({
  line1: z.string().max(200).optional().nullable(),
  line2: z.string().max(200).optional().nullable(),
  city: z.string().max(120).optional().nullable(),
  state: z.string().max(120).optional().nullable(),
  postalCode: z.string().max(40).optional().nullable(),
  country: z.string().min(2).max(2).regex(/^[A-Za-z]{2}$/).optional().nullable(),
});

const Contact = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email(),
  phone: z.string().max(40).optional().nullable(),
  role: z.string().max(120).optional().nullable(),
});

const ShippingAddress = Address.extend({
  label: z.string().max(120).optional().nullable(),
  recipient: z.string().max(200).optional().nullable(),
});

export const ProfilePatch = z.object({
  name: z.string().min(1).max(200).optional(),
  company: z.string().min(1).max(200).optional(),
  phone: z.string().max(40).optional().nullable(),
  region: z.string().min(2).max(16).optional(),
  vatId: z.string().max(32).optional().nullable(),
  billingAddress: Address.optional().nullable(),
  shippingAddresses: z.array(ShippingAddress).max(10).optional(),
  contacts: z.array(Contact).max(10).optional(),
  marketingOptIn: z.boolean().optional(),
});
export type ProfilePatchT = z.infer<typeof ProfilePatch>;

export interface CustomerProfile {
  id: string;
  email: string;
  name: string | null;
  company: string | null;
  phone: string | null;
  region: string | null;
  vatId: string | null;
  billingAddress: z.infer<typeof Address> | null;
  shippingAddresses: z.infer<typeof ShippingAddress>[];
  contacts: z.infer<typeof Contact>[];
  marketingOptIn: boolean;
  stripeCustomerId: string | null;
  createdAt: number;
  updatedAt: number;
  lastLoginAt: number | null;
}

function parseJson<T>(s: unknown, fallback: T): T {
  if (!s || typeof s !== 'string') return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

export async function getProfile(env: Env, customerId: string): Promise<CustomerProfile> {
  const row = await env.DB.prepare(
    `SELECT id, email, name, company, phone, region, vat_id, billing_address_json,
            shipping_addresses_json, contacts_json, marketing_opt_in,
            stripe_customer_id, created_at, updated_at, last_login_at
       FROM customers WHERE id = ?`,
  )
    .bind(customerId)
    .first<Record<string, unknown>>();
  if (!row) throw Errors.notFound('Customer not found');
  return {
    id: String(row.id),
    email: String(row.email),
    name: (row.name as string | null) ?? null,
    company: (row.company as string | null) ?? null,
    phone: (row.phone as string | null) ?? null,
    region: (row.region as string | null) ?? null,
    vatId: (row.vat_id as string | null) ?? null,
    billingAddress: parseJson(row.billing_address_json, null as z.infer<typeof Address> | null),
    shippingAddresses: parseJson(row.shipping_addresses_json, [] as z.infer<typeof ShippingAddress>[]),
    contacts: parseJson(row.contacts_json, [] as z.infer<typeof Contact>[]),
    marketingOptIn: Number(row.marketing_opt_in ?? 0) === 1,
    stripeCustomerId: (row.stripe_customer_id as string | null) ?? null,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    lastLoginAt: row.last_login_at ? Number(row.last_login_at) : null,
  };
}

export async function updateProfile(
  env: Env,
  customerId: string,
  patch: ProfilePatchT,
  reqMeta: { requestId: string; ip: string },
): Promise<CustomerProfile> {
  const existing = await getProfile(env, customerId);
  const sets: string[] = [];
  const args: unknown[] = [];
  const changed: Record<string, true> = {};

  if (patch.name !== undefined) { sets.push('name = ?'); args.push(patch.name); changed.name = true; }
  if (patch.company !== undefined) { sets.push('company = ?'); args.push(patch.company); changed.company = true; }
  if (patch.phone !== undefined) { sets.push('phone = ?'); args.push(patch.phone); changed.phone = true; }
  if (patch.region !== undefined) { sets.push('region = ?'); args.push(patch.region); changed.region = true; }
  if (patch.vatId !== undefined) { sets.push('vat_id = ?'); args.push(patch.vatId); changed.vatId = true; }
  if (patch.billingAddress !== undefined) {
    sets.push('billing_address_json = ?');
    args.push(patch.billingAddress ? JSON.stringify(patch.billingAddress) : null);
    changed.billingAddress = true;
  }
  if (patch.shippingAddresses !== undefined) {
    sets.push('shipping_addresses_json = ?');
    args.push(JSON.stringify(patch.shippingAddresses));
    changed.shippingAddresses = true;
  }
  if (patch.contacts !== undefined) {
    sets.push('contacts_json = ?');
    args.push(JSON.stringify(patch.contacts));
    changed.contacts = true;
  }
  if (patch.marketingOptIn !== undefined) {
    sets.push('marketing_opt_in = ?');
    args.push(patch.marketingOptIn ? 1 : 0);
    changed.marketingOptIn = true;
  }

  if (sets.length === 0) return existing;
  sets.push('updated_at = ?');
  args.push(Date.now());
  args.push(customerId);
  await env.DB.prepare(`UPDATE customers SET ${sets.join(', ')} WHERE id = ?`).bind(...args).run();

  // Best-effort mirror to the Stripe customer record so billing-address /
  // contact changes flow through to invoices. Failures are logged but don't
  // break the portal — Stripe will be reconciled on the next checkout/invoice.
  if (env.STRIPE_SECRET_KEY) {
    try {
      await mirrorToStripe(env, existing.stripeCustomerId, { ...existing, ...patch });
    } catch (err) {
      await logEvent(env.DB, {
        type: 'customer.stripe_sync_failed',
        actorKind: 'customer',
        actorId: customerId,
        subjectKind: 'customer',
        subjectId: customerId,
        requestId: reqMeta.requestId,
        ip: reqMeta.ip,
        payload: { err: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  await logEvent(env.DB, {
    type: 'customer.profile_updated',
    actorKind: 'customer',
    actorId: customerId,
    subjectKind: 'customer',
    subjectId: customerId,
    requestId: reqMeta.requestId,
    ip: reqMeta.ip,
    payload: { changed: Object.keys(changed) },
  });
  return getProfile(env, customerId);
}

async function mirrorToStripe(
  env: Env,
  stripeCustomerId: string | null,
  data: { email: string; name: string | null; company: string | null; phone: string | null;
          billingAddress: z.infer<typeof Address> | null; shippingAddresses: z.infer<typeof ShippingAddress>[];
          vatId: string | null },
) {
  const body: Record<string, unknown> = {
    name: data.name ?? data.company ?? undefined,
    description: data.company ?? undefined,
    phone: data.phone ?? undefined,
  };
  if (data.billingAddress) {
    body['address[line1]'] = data.billingAddress.line1 ?? '';
    body['address[line2]'] = data.billingAddress.line2 ?? '';
    body['address[city]'] = data.billingAddress.city ?? '';
    body['address[state]'] = data.billingAddress.state ?? '';
    body['address[postal_code]'] = data.billingAddress.postalCode ?? '';
    body['address[country]'] = data.billingAddress.country ?? '';
  }
  const ship = data.shippingAddresses[0];
  if (ship) {
    body['shipping[name]'] = ship.recipient ?? data.name ?? data.company ?? data.email;
    body['shipping[address][line1]'] = ship.line1 ?? '';
    body['shipping[address][line2]'] = ship.line2 ?? '';
    body['shipping[address][city]'] = ship.city ?? '';
    body['shipping[address][state]'] = ship.state ?? '';
    body['shipping[address][postal_code]'] = ship.postalCode ?? '';
    body['shipping[address][country]'] = ship.country ?? '';
  }
  if (stripeCustomerId) {
    await stripeRequest(env, `/v1/customers/${encodeURIComponent(stripeCustomerId)}`, body);
  }
}

export async function recordPrivacyRequest(
  env: Env,
  customerId: string,
  kind: 'export' | 'delete',
  notes: string | null,
  reqMeta: { requestId: string; ip: string },
): Promise<{ id: string; kind: string; status: string; requestedAt: number }> {
  const id = `pr_${newShortId()}`;
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO privacy_requests (id, customer_id, kind, status, notes, requested_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, customerId, kind, kind === 'export' ? 'completed' : 'received', notes, now)
    .run();
  if (kind === 'export') {
    await env.DB.prepare(`UPDATE privacy_requests SET completed_at = ? WHERE id = ?`)
      .bind(now, id).run();
  }
  await logEvent(env.DB, {
    type: kind === 'export' ? 'customer.export_requested' : 'customer.delete_requested',
    actorKind: 'customer',
    actorId: customerId,
    subjectKind: 'customer',
    subjectId: customerId,
    requestId: reqMeta.requestId,
    ip: reqMeta.ip,
  });
  return { id, kind, status: kind === 'export' ? 'completed' : 'received', requestedAt: now };
}

export async function buildDataExport(env: Env, customerId: string) {
  const profile = await getProfile(env, customerId);
  const [orders, quotes, configurations, notes, invoices, privacy] = await Promise.all([
    env.DB.prepare(`SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at`).bind(customerId).all(),
    env.DB.prepare(`SELECT * FROM quotes WHERE customer_id = ? ORDER BY created_at`).bind(customerId).all(),
    env.DB.prepare(`SELECT * FROM configurations WHERE customer_id = ? ORDER BY created_at`).bind(customerId).all(),
    env.DB.prepare(
      `SELECT n.* FROM order_notes n JOIN orders o ON o.id = n.order_id
        WHERE o.customer_id = ? ORDER BY n.created_at`,
    ).bind(customerId).all(),
    env.DB.prepare(
      `SELECT i.* FROM invoices i JOIN orders o ON o.id = i.order_id
        WHERE o.customer_id = ? ORDER BY i.issued_at`,
    ).bind(customerId).all(),
    env.DB.prepare(`SELECT * FROM privacy_requests WHERE customer_id = ? ORDER BY requested_at`).bind(customerId).all(),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    profile,
    orders: orders.results ?? [],
    quotes: quotes.results ?? [],
    configurations: configurations.results ?? [],
    orderNotes: notes.results ?? [],
    invoices: invoices.results ?? [],
    privacyRequests: privacy.results ?? [],
  };
}

export async function listConfigurationsForCustomer(env: Env, customerId: string) {
  const { results } = await env.DB.prepare(
    `SELECT id, source, region, payload_json, totals_json, catalog_version, created_at, updated_at
       FROM configurations WHERE customer_id = ? ORDER BY created_at DESC LIMIT 200`,
  ).bind(customerId).all<Record<string, unknown>>();
  return (results ?? []).map((r) => ({
    id: String(r.id),
    source: String(r.source),
    region: String(r.region),
    payload: parseJson(r.payload_json, {}),
    totals: parseJson(r.totals_json, {}),
    catalogVersion: String(r.catalog_version),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  }));
}
