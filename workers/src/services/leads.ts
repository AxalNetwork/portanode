import { z } from 'zod';
import type { Env } from '../env';
import { newShortId } from '../lib/ids';
import { logEvent } from '../db/events';

export const ContactInput = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(200).optional(),
  company: z.string().max(200).optional(),
  phone: z.string().max(40).optional(),
  region: z.string().max(16).optional(),
  message: z.string().min(1).max(4000),
  utm: z.record(z.string(), z.string()).optional(),
});

export const LeasingInput = ContactInput.extend({
  estimatedDeploymentMonth: z.string().max(7).optional(),
  estimatedSpendUsd: z.number().nonnegative().optional(),
});

export const SpecDownloadInput = z.object({
  email: z.string().email(),
  name: z.string().max(200).optional(),
  company: z.string().max(200).optional(),
  region: z.string().max(16).optional(),
  assetId: z.string().min(1).max(80),
  utm: z.record(z.string(), z.string()).optional(),
});

export type LeadKind = 'contact' | 'leasing' | 'spec_download' | 'newsletter';

export async function createLead(
  env: Env,
  kind: LeadKind,
  input: {
    email: string;
    name?: string;
    company?: string;
    phone?: string;
    region?: string;
    message?: string;
    assetId?: string;
    utm?: Record<string, string>;
  },
  reqMeta: { requestId: string; ip: string; userAgent?: string },
) {
  const id = newShortId();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO leads (
        id, kind, email, name, company, phone, region, message, asset_id, utm_json,
        ip, user_agent, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)`,
  )
    .bind(
      id,
      kind,
      input.email,
      input.name ?? null,
      input.company ?? null,
      input.phone ?? null,
      input.region ?? null,
      input.message ?? null,
      input.assetId ?? null,
      input.utm ? JSON.stringify(input.utm) : null,
      reqMeta.ip,
      reqMeta.userAgent ?? null,
      now,
      now,
    )
    .run();
  await logEvent(env.DB, {
    type: `lead.${kind}.created`,
    actorKind: 'system',
    subjectKind: 'lead',
    subjectId: id,
    requestId: reqMeta.requestId,
    ip: reqMeta.ip,
    payload: { kind, email: input.email },
  });
  return { id, createdAt: now };
}

export async function listLeadsAdmin(env: Env, kind?: string, status?: string, limit = 200) {
  const where: string[] = [];
  const args: unknown[] = [];
  if (kind) { where.push('kind = ?'); args.push(kind); }
  if (status) { where.push('status = ?'); args.push(status); }
  const sql = `SELECT * FROM leads ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ?`;
  args.push(limit);
  const { results } = await env.DB.prepare(sql).bind(...args).all();
  return results ?? [];
}
