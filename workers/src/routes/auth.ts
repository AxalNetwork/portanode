import { Hono } from 'hono';
import type { AppContext } from '../env';
import { Errors } from '../lib/errors';
import { rateLimit } from '../middleware/rate-limit';
import { turnstile } from '../middleware/turnstile';
import { requireCustomer } from '../middleware/auth';
import { setSessionCookie, clearSessionCookie } from '../lib/cookies';
import { safeRedirectPath } from '../lib/safe-redirect';
import {
  MagicLinkRequest,
  consumeMagicLink,
  requestMagicLink,
  revokeSession,
} from '../services/auth';

export const auth = new Hono<AppContext>();

/** POST /api/auth/magic-link — request a magic link */
auth.post(
  '/magic-link',
  rateLimit((env) => env.RL_AUTH),
  turnstile,
  async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = MagicLinkRequest.safeParse(body);
    if (!parsed.success) throw Errors.invalid(parsed.error.flatten());
    await requestMagicLink(c.env, parsed.data, {
      requestId: c.get('requestId'),
      ip: c.get('ip'),
    });
    // Always 202 to prevent account enumeration.
    return c.json({ data: { ok: true } }, 202);
  },
);

/** GET /api/auth/magic?token=...&redirect=...
 *  Click-through endpoint: consumes token, sets session cookie, 302s to app.
 */
auth.get('/magic', async (c) => {
  const token = c.req.query('token');
  if (!token) throw Errors.badRequest('Missing token');
  const session = await consumeMagicLink(c.env, token, {
    requestId: c.get('requestId'),
    ip: c.get('ip'),
    userAgent: c.req.header('user-agent') ?? undefined,
  });
  setSessionCookie(c, c.env, session.token, session.ttlSec);
  const redirect = safeRedirectPath(c.req.query('redirect') ?? session.redirectTo);
  const url = new URL(redirect, c.env.APP_BASE_URL).toString();
  return c.redirect(url, 302);
});

/** GET /api/auth/me — current customer + csrf token */
auth.get('/me', requireCustomer, async (c) => {
  const customer = c.get('customer')!;
  const row = await c.env.DB.prepare(
    `SELECT id, email, name, company, region FROM customers WHERE id = ?`,
  )
    .bind(customer.id)
    .first<{ id: string; email: string; name: string | null; company: string | null; region: string | null }>();
  const session = await c.env.DB.prepare(`SELECT csrf_token FROM sessions WHERE jti = ?`)
    .bind(customer.jti)
    .first<{ csrf_token: string }>();
  return c.json({ data: { customer: row, csrfToken: session?.csrf_token } });
});

/** POST /api/auth/logout */
auth.post('/logout', requireCustomer, async (c) => {
  const customer = c.get('customer')!;
  await revokeSession(c.env, customer.jti);
  clearSessionCookie(c, c.env);
  return c.json({ data: { ok: true } });
});
