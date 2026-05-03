/**
 * Admin compliance endpoints — restricted-country list management,
 * sanctions-screening review, KYB review.
 *
 * Mounted from `routes/admin.ts` after `requireAdmin`. The CRUD model is
 * intentionally narrow: ops never edits sanctions matches by hand (they
 * either approve or reject the screen), and the KYB toggle records who
 * reviewed and when.
 */
import type { Hono } from 'hono';
import { z } from 'zod';
import type { AppContext } from '../env';
import { Errors } from '../lib/errors';
import {
  resolveRestrictedList,
  setRestrictedList,
  DEFAULT_RESTRICTED,
} from '../lib/restricted-countries';
import { logEvent } from '../db/events';

export function registerAdminCompliance(admin: Hono<AppContext>) {
  // ── Restricted countries (KV-backed) ────────────────────────────────────
  admin.get('/compliance/countries', async (c) => {
    const data = await resolveRestrictedList(c.env);
    return c.json({ data });
  });

  const CountryListPatch = z.object({
    blocked: z.array(z.string()).max(250).optional(),
    allowed: z.array(z.string()).max(250).optional(),
  });
  admin.put('/compliance/countries', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = CountryListPatch.safeParse(body);
    if (!parsed.success) throw Errors.invalid(parsed.error.flatten());
    const next = await setRestrictedList(c.env, {
      blocked: parsed.data.blocked,
      allowed: parsed.data.allowed,
      updatedBy: c.get('admin')?.tokenHashPrefix ?? 'admin',
    });
    await logEvent(c.env.DB, {
      type: 'compliance.country_list_updated',
      actorKind: 'admin',
      subjectKind: 'config',
      subjectId: 'restricted_countries',
      requestId: c.get('requestId'),
      ip: c.get('ip'),
      payload: { blocked: next.blocked, allowed: next.allowed },
    });
    return c.json({ data: { ...next, defaults: [...DEFAULT_RESTRICTED] } });
  });

  admin.get('/compliance/blocks', async (c) => {
    const limit = Math.min(parseInt(c.req.query('limit') ?? '100', 10) || 100, 500);
    const { results } = await c.env.DB.prepare(
      `SELECT id, country, list_source, context, customer_id, email, request_id, created_at
         FROM restricted_blocks ORDER BY created_at DESC LIMIT ?`,
    )
      .bind(limit)
      .all();
    return c.json({ data: results ?? [] });
  });

  // ── Sanctions screenings ────────────────────────────────────────────────
  admin.get('/compliance/sanctions', async (c) => {
    const status = c.req.query('status') ?? null;
    const limit = Math.min(parseInt(c.req.query('limit') ?? '100', 10) || 100, 500);
    const sql = status
      ? `SELECT * FROM sanctions_screenings WHERE status = ? ORDER BY created_at DESC LIMIT ?`
      : `SELECT * FROM sanctions_screenings ORDER BY created_at DESC LIMIT ?`;
    const stmt = status
      ? c.env.DB.prepare(sql).bind(status, limit)
      : c.env.DB.prepare(sql).bind(limit);
    const { results } = await stmt.all();
    const data = (results ?? []).map((r: Record<string, unknown>) => ({
      id: String(r.id),
      customerId: String(r.customer_id),
      status: String(r.status),
      queryName: String(r.query_name),
      queryCountry: (r.query_country as string | null) ?? null,
      matchCount: Number(r.match_count ?? 0),
      topScore: r.top_score == null ? null : Number(r.top_score),
      matches: r.matches_json ? JSON.parse(String(r.matches_json)) : [],
      provider: String(r.provider),
      reviewedBy: (r.reviewed_by as string | null) ?? null,
      reviewedAt: r.reviewed_at ? Number(r.reviewed_at) : null,
      createdAt: Number(r.created_at),
    }));
    return c.json({ data });
  });

  // Single canonical taxonomy for screening rows. Auto path emits
  // `clear|review|pending` (pending = provider error / not-yet-scored);
  // admin closes the row out by transitioning to `clear|matched|escalated`.
  // Customer-level mirror status is independent: `clear|review|blocked`.
  const ScreeningPatch = z.object({
    status: z.enum(['clear', 'matched', 'escalated']),
    customerStatus: z.enum(['clear', 'review', 'blocked']).optional(),
  });
  admin.patch('/compliance/sanctions/:id', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = ScreeningPatch.safeParse(body);
    if (!parsed.success) throw Errors.invalid(parsed.error.flatten());
    const id = c.req.param('id');
    const row = await c.env.DB.prepare(
      `SELECT customer_id FROM sanctions_screenings WHERE id = ?`,
    )
      .bind(id)
      .first<{ customer_id: string }>();
    if (!row) throw Errors.notFound('Screening not found');
    const reviewer = c.get('admin')?.tokenHashPrefix ?? 'admin';
    const now = Date.now();
    await c.env.DB.prepare(
      `UPDATE sanctions_screenings
          SET status = ?, reviewed_by = ?, reviewed_at = ?
        WHERE id = ?`,
    )
      .bind(parsed.data.status, reviewer, now, id)
      .run();
    if (parsed.data.customerStatus) {
      await c.env.DB.prepare(
        `UPDATE customers SET sanctions_status = ?, sanctions_reviewed_at = ? WHERE id = ?`,
      )
        .bind(parsed.data.customerStatus, now, row.customer_id)
        .run();
    }
    await logEvent(c.env.DB, {
      type: 'compliance.sanctions_reviewed',
      actorKind: 'admin',
      subjectKind: 'customer',
      subjectId: row.customer_id,
      requestId: c.get('requestId'),
      ip: c.get('ip'),
      payload: { id, status: parsed.data.status, customerStatus: parsed.data.customerStatus },
    });
    return c.json({ data: { id, status: parsed.data.status, reviewedAt: now } });
  });

  // ── KYB review on orders ────────────────────────────────────────────────
  const KybPatch = z.object({
    status: z.enum(['pending', 'cleared', 'rejected']),
    providerRef: z.string().max(200).nullable().optional(),
  });
  admin.patch('/orders/:id/kyb', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = KybPatch.safeParse(body);
    if (!parsed.success) throw Errors.invalid(parsed.error.flatten());
    const id = c.req.param('id');
    const order = await c.env.DB.prepare(`SELECT id FROM orders WHERE id = ?`)
      .bind(id)
      .first<{ id: string }>();
    if (!order) throw Errors.notFound('Order not found');
    const reviewer = c.get('admin')?.tokenHashPrefix ?? 'admin';
    const now = Date.now();
    await c.env.DB.prepare(
      `UPDATE orders
          SET kyb_status = ?, kyb_provider_ref = COALESCE(?, kyb_provider_ref),
              kyb_reviewed_by = ?, kyb_reviewed_at = ?, updated_at = ?
        WHERE id = ?`,
    )
      .bind(
        parsed.data.status,
        parsed.data.providerRef ?? null,
        reviewer,
        now,
        now,
        id,
      )
      .run();
    await logEvent(c.env.DB, {
      type: 'compliance.kyb_reviewed',
      actorKind: 'admin',
      subjectKind: 'order',
      subjectId: id,
      requestId: c.get('requestId'),
      ip: c.get('ip'),
      payload: { status: parsed.data.status, providerRef: parsed.data.providerRef ?? null },
    });
    return c.json({ data: { id, kybStatus: parsed.data.status, kybReviewedAt: now } });
  });

  admin.get('/compliance/kyb/pending', async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT id, customer_id, total_cents, currency, status, kyb_status,
              kyb_provider_ref, kyb_reviewed_at, created_at
         FROM orders WHERE kyb_status = 'pending' ORDER BY created_at DESC LIMIT 200`,
    )
      .all();
    return c.json({ data: results ?? [] });
  });
}
