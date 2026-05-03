import type { Hono } from 'hono';
import { z } from 'zod';
import type { AppContext } from '../env';
import { Errors } from '../lib/errors';
import { readCookie } from '../lib/cookies';
import { sha256Hex, randomToken, timingSafeEqual } from '../lib/crypto';
import { logEvent } from '../db/events';
import {
  CustomerNoteInput,
  TaskInput,
  TaskPatch,
  LeadPatch,
  addCustomerNote,
  listCustomerNotes,
  deleteCustomerNote,
  listTasks,
  createTask,
  patchTask,
  deleteTask,
  searchCustomers,
  listCustomersAdmin,
  getCustomerView,
  patchLead,
  dashboardCounts,
} from '../services/crm';
import {
  takeSnapshot,
  listSnapshots,
  diffSnapshots,
  type CatalogPayloadInput,
} from '../services/pricing-review';
import { buildExportBundle, listExports, getExportObject } from '../services/admin-export';
import { runDailyTaskDigest, runWeeklySnapshot } from '../services/admin-cron';

// Admin extras — registered onto the existing `admin` Hono instance from
// `routes/admin.ts`. Splitting the handlers across two functions lets the
// caller place them on either side of the `admin.use('*', requireAdmin)`
// middleware so login/logout don't require a cookie that hasn't been
// issued yet.

/** Routes that must be reachable without a session: login (issue cookie),
 *  logout (clear cookie). Both still validate the bearer token before
 *  granting any state. */
export function registerAdminPublic(admin: Hono<AppContext>) {
  const LoginInput = z.object({
    token: z.string().min(8).max(512).optional(),
  });

  admin.post('/login', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = LoginInput.safeParse(body);
    if (!parsed.success) throw Errors.invalid(parsed.error.flatten());
    const headerAuth = c.req.header('authorization') ?? '';
    const fromHeader = headerAuth.startsWith('Bearer ') ? headerAuth.slice(7) : '';
    const presented = parsed.data.token ?? fromHeader;
    const expected = c.env.ADMIN_API_TOKEN ?? '';
    if (!presented || !expected || !timingSafeEqual(presented, expected)) {
      throw Errors.unauthorized('Invalid admin token');
    }
    const cookie = randomToken(32);
    const hash = await sha256Hex(cookie);
    const now = Date.now();
    const ttlSec = 12 * 60 * 60; // 12h: typical ops-shift length
    const expiresAt = now + ttlSec * 1000;
    await c.env.DB.prepare(
      `INSERT INTO admin_sessions (token_hash, label, created_at, expires_at, last_used_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(hash, c.req.header('user-agent')?.slice(0, 200) ?? null, now, expiresAt, now)
      .run();
    const secure = c.env.ENVIRONMENT !== 'development';
    const parts = [
      `axal_admin=${cookie}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      `Max-Age=${ttlSec}`,
    ];
    if (secure) parts.push('Secure');
    c.header('Set-Cookie', parts.join('; '), { append: true });
    await logEvent(c.env.DB, {
      type: 'admin.login',
      actorKind: 'admin',
      actorId: hash.slice(0, 6),
      requestId: c.get('requestId'),
      ip: c.get('ip'),
    });
    return c.json({ data: { ok: true, expiresAt } });
  });

  admin.post('/logout', async (c) => {
    const cookie = readCookie(c, 'axal_admin');
    if (cookie) {
      const hash = await sha256Hex(cookie);
      await c.env.DB.prepare(
        `UPDATE admin_sessions SET revoked_at = ? WHERE token_hash = ?`,
      )
        .bind(Date.now(), hash)
        .run();
    }
    const secure = c.env.ENVIRONMENT !== 'development';
    const parts = ['axal_admin=', 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
    if (secure) parts.push('Secure');
    c.header('Set-Cookie', parts.join('; '), { append: true });
    return c.json({ data: { ok: true } });
  });
}

/** Routes that require admin auth (cookie or bearer). Registered after the
 *  `admin.use('*', requireAdmin)` line in `routes/admin.ts`. */
export function registerAdminProtected(admin: Hono<AppContext>) {
  // Whoami probe so the SPA can decide between the login screen and the shell.
  admin.get('/me', (c) => {
    const adminCtx = c.get('admin');
    return c.json({ data: { ok: true, tokenHashPrefix: adminCtx?.tokenHashPrefix } });
  });

  // --- Dashboard counts ---
  admin.get('/dashboard/counts', async (c) => {
    const data = await dashboardCounts(c.env);
    return c.json({ data });
  });

  // --- Customers ---
  admin.get('/customers', async (c) => {
    const q = c.req.query('q');
    const limit = Math.min(parseInt(c.req.query('limit') ?? '100', 10) || 100, 500);
    const data = q ? await searchCustomers(c.env, q, limit) : await listCustomersAdmin(c.env, limit);
    return c.json({ data });
  });

  admin.get('/customers/:id', async (c) => {
    const view = await getCustomerView(c.env, c.req.param('id'));
    if (!view) throw Errors.notFound('Customer not found');
    return c.json({ data: view });
  });

  admin.get('/customers/:id/notes', async (c) => {
    const data = await listCustomerNotes(c.env, c.req.param('id'));
    return c.json({ data });
  });

  admin.post('/customers/:id/notes', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = CustomerNoteInput.safeParse(body);
    if (!parsed.success) throw Errors.invalid(parsed.error.flatten());
    const adminCtx = c.get('admin');
    const note = await addCustomerNote(
      c.env,
      c.req.param('id'),
      parsed.data.body,
      adminCtx?.tokenHashPrefix ?? 'admin',
      { requestId: c.get('requestId'), ip: c.get('ip') },
    );
    return c.json({ data: note }, 201);
  });

  admin.delete('/notes/:id', async (c) => {
    await deleteCustomerNote(c.env, c.req.param('id'));
    return c.json({ data: { ok: true } });
  });

  // --- Leads PATCH ---
  admin.patch('/leads/:id', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = LeadPatch.safeParse(body);
    if (!parsed.success) throw Errors.invalid(parsed.error.flatten());
    const adminCtx = c.get('admin');
    await patchLead(c.env, c.req.param('id'), parsed.data, adminCtx?.tokenHashPrefix ?? 'admin', {
      requestId: c.get('requestId'),
      ip: c.get('ip'),
    });
    return c.json({ data: { ok: true } });
  });

  // --- Tasks ---
  admin.get('/tasks', async (c) => {
    const status = (c.req.query('status') ?? 'open') as 'open' | 'completed' | 'overdue' | 'all';
    const customerId = c.req.query('customerId') ?? undefined;
    const orderId = c.req.query('orderId') ?? undefined;
    const data = await listTasks(c.env, { status, customerId, orderId });
    return c.json({ data });
  });

  admin.post('/tasks', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = TaskInput.safeParse(body);
    if (!parsed.success) throw Errors.invalid(parsed.error.flatten());
    const adminCtx = c.get('admin');
    const task = await createTask(c.env, parsed.data, adminCtx?.tokenHashPrefix ?? 'admin', {
      requestId: c.get('requestId'),
      ip: c.get('ip'),
    });
    return c.json({ data: task }, 201);
  });

  admin.patch('/tasks/:id', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = TaskPatch.safeParse(body);
    if (!parsed.success) throw Errors.invalid(parsed.error.flatten());
    const adminCtx = c.get('admin');
    const task = await patchTask(
      c.env,
      c.req.param('id'),
      parsed.data,
      adminCtx?.tokenHashPrefix ?? 'admin',
      { requestId: c.get('requestId'), ip: c.get('ip') },
    );
    return c.json({ data: task });
  });

  admin.delete('/tasks/:id', async (c) => {
    await deleteTask(c.env, c.req.param('id'));
    return c.json({ data: { ok: true } });
  });

  // --- Pricing review ---
  const SnapshotInput = z.object({
    payload: z.unknown(),
    notes: z.string().max(2000).optional(),
  });

  admin.get('/pricing/snapshots', async (c) => {
    const data = await listSnapshots(c.env);
    return c.json({ data });
  });

  admin.post('/pricing/snapshot', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = SnapshotInput.safeParse(body);
    if (!parsed.success) throw Errors.invalid(parsed.error.flatten());
    const adminCtx = c.get('admin');
    const snap = await takeSnapshot(
      c.env,
      parsed.data.payload,
      adminCtx?.tokenHashPrefix ?? 'admin',
      parsed.data.notes,
    );
    return c.json(
      { data: { id: snap.id, takenAt: snap.takenAt, catalogVersion: snap.catalogVersion } },
      201,
    );
  });

  // The live catalog body is opaque user-supplied JSON. We narrow it with a
  // permissive schema and lean on `pricing-review.ts` for shape-tolerant
  // indexing rather than enforcing the full catalog schema here.
  const LiveCatalog = z
    .object({
      version: z.string().optional(),
      modules: z.array(z.unknown()).optional(),
    })
    .passthrough();
  const DiffInput = z.object({
    fromId: z.string().optional().nullable(),
    liveCatalog: LiveCatalog.optional(),
  });

  admin.post('/pricing/diff', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = DiffInput.safeParse(body);
    if (!parsed.success) throw Errors.invalid(parsed.error.flatten());
    const live = parsed.data.liveCatalog
      ? {
          id: 'live' as const,
          takenAt: Date.now(),
          catalogVersion: parsed.data.liveCatalog.version ?? null,
          payload: parsed.data.liveCatalog as CatalogPayloadInput,
        }
      : null;
    const data = await diffSnapshots(c.env, parsed.data.fromId ?? null, live);
    return c.json({ data });
  });

  // --- Exports ---
  admin.get('/exports', async (c) => {
    const data = await listExports(c.env);
    return c.json({ data });
  });

  admin.post('/exports/run', async (c) => {
    const result = await buildExportBundle(c.env);
    return c.json({ data: result }, 201);
  });

  admin.get('/exports/object', async (c) => {
    const key = c.req.query('key') ?? '';
    const obj = await getExportObject(c.env, key);
    if (!obj) throw Errors.notFound('Export not found');
    const filename = key.split('/').pop() ?? 'export.zip';
    const isZip = filename.endsWith('.zip');
    return new Response(obj.body, {
      headers: {
        'content-type': isZip ? 'application/zip' : 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${filename}"`,
        'cache-control': 'no-store',
      },
    });
  });

  // --- Cron manual triggers ---
  admin.post('/cron/digest', async (c) => {
    const data = await runDailyTaskDigest(c.env);
    return c.json({ data });
  });

  admin.post('/cron/snapshot', async (c) => {
    const data = await runWeeklySnapshot(c.env);
    return c.json({ data });
  });
}
