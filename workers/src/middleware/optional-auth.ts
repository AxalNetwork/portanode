import type { MiddlewareHandler } from 'hono';
import type { AppContext } from '../env';
import { readCookie } from '../lib/cookies';
import { verifySession } from '../lib/jwt';
import { timingSafeEqual } from '../lib/crypto';
import { Errors } from '../lib/errors';

/**
 * If a valid session cookie is present, populate `c.var.customer` so public
 * endpoints can attribute writes to the signed-in customer. Missing or
 * cryptographically-invalid cookies are silently ignored — endpoints stay
 * anonymous-friendly.
 *
 * Important: only **JWT verification failures** are swallowed (those mean the
 * cookie is bad and the caller is effectively anonymous). DB lookups and any
 * other unexpected errors propagate so they cannot silently disable
 * cookie-attributed CSRF enforcement during an infrastructure outage.
 *
 * Unsafe methods still require a CSRF header when a session is in play.
 */
export const optionalCustomer: MiddlewareHandler<AppContext> = async (c, next) => {
  const token = readCookie(c, c.env.SESSION_COOKIE_NAME);
  if (!token) return next();

  let claims;
  try {
    claims = await verifySession(c.env, token);
  } catch {
    // Bad / expired / tampered cookie — proceed anonymously.
    return next();
  }

  const row = await c.env.DB.prepare(
    `SELECT csrf_token, expires_at, revoked_at FROM sessions WHERE jti = ?`,
  )
    .bind(claims.jti)
    .first<{ csrf_token: string; expires_at: number; revoked_at: number | null }>();
  if (!row || row.revoked_at || row.expires_at < Date.now()) return next();

  const unsafe =
    c.req.method !== 'GET' && c.req.method !== 'HEAD' && c.req.method !== 'OPTIONS';
  if (unsafe) {
    const header = c.req.header('x-csrf-token') ?? '';
    if (!header || !timingSafeEqual(header, row.csrf_token)) {
      throw Errors.forbidden('CSRF token missing or invalid');
    }
  }
  c.set('customer', { id: claims.sub, email: claims.email, jti: claims.jti });
  return next();
};
