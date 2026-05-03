import type { MiddlewareHandler } from 'hono';
import type { AppContext } from '../env';
import { Errors } from '../lib/errors';
import { readCookie } from '../lib/cookies';
import { verifySession } from '../lib/jwt';
import { timingSafeEqual, sha256Hex } from '../lib/crypto';

/** Requires a valid customer session cookie. Populates `c.var.customer`. */
export const requireCustomer: MiddlewareHandler<AppContext> = async (c, next) => {
  const token = readCookie(c, c.env.SESSION_COOKIE_NAME);
  if (!token) throw Errors.unauthorized();
  let claims;
  try {
    claims = await verifySession(c.env, token);
  } catch {
    throw Errors.unauthorized('Invalid session');
  }
  // Confirm session not revoked / still active
  const row = await c.env.DB.prepare(
    `SELECT csrf_token, expires_at, revoked_at FROM sessions WHERE jti = ?`,
  )
    .bind(claims.jti)
    .first<{ csrf_token: string; expires_at: number; revoked_at: number | null }>();
  if (!row || row.revoked_at || row.expires_at < Date.now()) {
    throw Errors.unauthorized('Session expired');
  }
  c.set('customer', { id: claims.sub, email: claims.email, jti: claims.jti });

  // CSRF: require x-csrf-token header on unsafe methods
  const unsafe = c.req.method !== 'GET' && c.req.method !== 'HEAD' && c.req.method !== 'OPTIONS';
  if (unsafe) {
    const header = c.req.header('x-csrf-token') ?? '';
    if (!header || !timingSafeEqual(header, row.csrf_token)) {
      throw Errors.forbidden('CSRF token missing or invalid');
    }
  }
  return next();
};

/** Requires admin auth: either `Authorization: Bearer ADMIN_API_TOKEN` (used
 *  by curl / scripts) or a valid `axal_admin` cookie issued by `POST
 *  /admin/login` and tracked in the `admin_sessions` table. The cookie path
 *  is the one the SPA uses; the bearer path stays available so existing
 *  scripted callers keep working. */
export const requireAdmin: MiddlewareHandler<AppContext> = async (c, next) => {
  const auth = c.req.header('authorization') ?? '';
  const presented = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const expected = c.env.ADMIN_API_TOKEN ?? '';

  if (presented && expected && timingSafeEqual(presented, expected)) {
    c.set('admin', { tokenHashPrefix: presented.slice(0, 6) });
    return next();
  }

  const cookie = readCookie(c, 'axal_admin');
  if (cookie) {
    const hash = await sha256Hex(cookie);
    const row = await c.env.DB.prepare(
      `SELECT token_hash, expires_at, revoked_at FROM admin_sessions WHERE token_hash = ?`,
    )
      .bind(hash)
      .first<{ token_hash: string; expires_at: number; revoked_at: number | null }>();
    if (row && !row.revoked_at && row.expires_at > Date.now()) {
      // Bump last_used_at so we can spot dormant cookies and rotate.
      await c.env.DB.prepare(
        `UPDATE admin_sessions SET last_used_at = ? WHERE token_hash = ?`,
      )
        .bind(Date.now(), hash)
        .run();
      c.set('admin', { tokenHashPrefix: hash.slice(0, 6) });
      return next();
    }
  }

  throw Errors.unauthorized('Admin token required');
};
