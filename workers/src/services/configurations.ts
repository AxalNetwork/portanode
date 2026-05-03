import { z } from 'zod';
import type { Env } from '../env';
import { newConfigurationId } from '../lib/ids';
import { Errors } from '../lib/errors';
import { logEvent } from '../db/events';

export const ConfigurationInput = z.object({
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
export type ConfigurationInputT = z.infer<typeof ConfigurationInput>;

export interface ConfigurationRow {
  id: string;
  customerId: string | null;
  source: string;
  region: string;
  payload: unknown;
  totals: {
    priceUsd: number;
    weightKg: number;
    powerKw: number;
    leadTimeWeeks: number;
  };
  catalogVersion: string;
  createdAt: number;
  updatedAt: number;
}

const KV_TTL = 60 * 60 * 24 * 30; // 30 days
const kvKey = (id: string) => `cfg:${id}`;

export async function createConfiguration(
  env: Env,
  input: ConfigurationInputT,
  customerId: string | null,
  reqMeta: { requestId: string; ip: string },
): Promise<ConfigurationRow> {
  const id = newConfigurationId();
  const now = Date.now();
  const payloadJson = JSON.stringify(input.payload);
  const totalsJson = JSON.stringify(input.totals);
  await env.DB.prepare(
    `INSERT INTO configurations (id, customer_id, source, region, payload_json, totals_json, catalog_version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, customerId, input.source, input.region, payloadJson, totalsJson, input.catalogVersion, now, now)
    .run();

  const row: ConfigurationRow = {
    id,
    customerId,
    source: input.source,
    region: input.region,
    payload: input.payload,
    totals: input.totals,
    catalogVersion: input.catalogVersion,
    createdAt: now,
    updatedAt: now,
  };
  await env.CACHE.put(kvKey(id), JSON.stringify(row), { expirationTtl: KV_TTL });
  await logEvent(env.DB, {
    type: 'configuration.created',
    actorKind: customerId ? 'customer' : 'system',
    actorId: customerId,
    subjectKind: 'configuration',
    subjectId: id,
    requestId: reqMeta.requestId,
    ip: reqMeta.ip,
    payload: { region: input.region, totals: input.totals },
  });
  return row;
}

export async function getConfiguration(env: Env, id: string): Promise<ConfigurationRow | null> {
  const cached = await env.CACHE.get(kvKey(id));
  if (cached) return JSON.parse(cached) as ConfigurationRow;

  const row = await env.DB.prepare(
    `SELECT id, customer_id, source, region, payload_json, totals_json, catalog_version, created_at, updated_at
     FROM configurations WHERE id = ?`,
  )
    .bind(id)
    .first<{
      id: string;
      customer_id: string | null;
      source: string;
      region: string;
      payload_json: string;
      totals_json: string;
      catalog_version: string;
      created_at: number;
      updated_at: number;
    }>();
  if (!row) return null;
  const out: ConfigurationRow = {
    id: row.id,
    customerId: row.customer_id,
    source: row.source,
    region: row.region,
    payload: JSON.parse(row.payload_json),
    totals: JSON.parse(row.totals_json),
    catalogVersion: row.catalog_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  await env.CACHE.put(kvKey(id), JSON.stringify(out), { expirationTtl: KV_TTL });
  return out;
}

export function assertOwnership(row: ConfigurationRow, customerId: string | null) {
  if (row.customerId && row.customerId !== customerId) throw Errors.forbidden();
}
