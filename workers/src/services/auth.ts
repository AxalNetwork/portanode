import { z } from 'zod';
import type { Env } from '../env';
import { Errors } from '../lib/errors';
import { newCustomerId, newSessionJti } from '../lib/ids';
import { randomToken, sha256Hex } from '../lib/crypto';
import { signSession } from '../lib/jwt';
import { logEvent } from '../db/events';
import { sendEmail } from '../email/send';
import { safeRedirectPath } from '../lib/safe-redirect';

export const MagicLinkRequest = z.object({
  email: z.string().email(),
  redirectTo: z.string().max(400).optional(),
});

export const MagicLinkConsume = z.object({
  token: z.string().min(20).max(200),
});

export async function requestMagicLink(
  env: Env,
  input: { email: string; redirectTo?: string },
  reqMeta: { requestId: string; ip: string },
) {
  const email = input.email.toLowerCase().trim();
  // Upsert customer
  const existing = await env.DB.prepare(`SELECT id FROM customers WHERE email = ?`)
    .bind(email)
    .first<{ id: string }>();
  let customerId = existing?.id;
  const now = Date.now();
  if (!customerId) {
    customerId = newCustomerId();
    await env.DB.prepare(
      `INSERT INTO customers (id, email, created_at, updated_at) VALUES (?, ?, ?, ?)`,
    )
      .bind(customerId, email, now, now)
      .run();
    await logEvent(env.DB, {
      type: 'customer.created',
      actorKind: 'system',
      subjectKind: 'customer',
      subjectId: customerId,
      requestId: reqMeta.requestId,
      ip: reqMeta.ip,
      payload: { email },
    });
  }

  const token = randomToken(32);
  const tokenHash = await sha256Hex(token);
  const ttlMin = parseInt(env.MAGIC_LINK_TTL_MIN || '15', 10);
  const expiresAt = now + ttlMin * 60 * 1000;
  const redirectTo = safeRedirectPath(input.redirectTo);

  await env.DB.prepare(
    `INSERT INTO magic_links (token_hash, email, customer_id, redirect_to, expires_at, created_ip, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(tokenHash, email, customerId, redirectTo, expiresAt, reqMeta.ip, now)
    .run();

  const url = new URL(env.API_BASE_URL);
  url.pathname = '/api/auth/magic';
  url.searchParams.set('token', token);
  if (redirectTo) url.searchParams.set('redirect', redirectTo);
  const link = url.toString();

  await sendEmail(env, {
    to: email,
    template: 'magic-link',
    vars: { link, ttlMinutes: ttlMin, supportEmail: env.EMAIL_REPLY_TO },
    subject: 'Your AXAL sign-in link',
  }, { requestId: reqMeta.requestId, subjectKind: 'customer', subjectId: customerId });

  return { ok: true };
}

export async function consumeMagicLink(
  env: Env,
  token: string,
  reqMeta: { requestId: string; ip: string; userAgent?: string },
) {
  const tokenHash = await sha256Hex(token);
  const now = Date.now();

  // Atomic single-use consume: only the first concurrent caller flips
  // `consumed_at` from NULL → now and gets `meta.changes === 1`. Losers
  // (already-consumed or expired tokens) see `changes === 0`.
  const upd = await env.DB.prepare(
    `UPDATE magic_links
        SET consumed_at = ?
      WHERE token_hash = ?
        AND consumed_at IS NULL
        AND expires_at >= ?`,
  )
    .bind(now, tokenHash, now)
    .run();
  if (!upd.meta || upd.meta.changes !== 1) {
    await logEvent(env.DB, {
      type: 'auth.magic_consume_failed',
      actorKind: 'system',
      subjectKind: 'magic_link',
      requestId: reqMeta.requestId,
      ip: reqMeta.ip,
      payload: { reason: 'invalid_or_expired_or_used' },
    });
    throw Errors.unauthorized('Invalid or expired link');
  }
  const row = await env.DB.prepare(
    `SELECT email, customer_id, redirect_to FROM magic_links WHERE token_hash = ?`,
  )
    .bind(tokenHash)
    .first<{ email: string; customer_id: string; redirect_to: string | null }>();
  if (!row) throw Errors.unauthorized('Invalid or expired link');
  await env.DB.prepare(`UPDATE customers SET last_login_at = ?, updated_at = ? WHERE id = ?`)
    .bind(now, now, row.customer_id)
    .run();

  const session = await issueSession(env, {
    customerId: row.customer_id,
    email: row.email,
    ip: reqMeta.ip,
    userAgent: reqMeta.userAgent,
  });

  await logEvent(env.DB, {
    type: 'auth.magic_consumed',
    actorKind: 'customer',
    actorId: row.customer_id,
    subjectKind: 'customer',
    subjectId: row.customer_id,
    requestId: reqMeta.requestId,
    ip: reqMeta.ip,
  });

  return { ...session, redirectTo: safeRedirectPath(row.redirect_to) };
}

export async function issueSession(
  env: Env,
  args: { customerId: string; email: string; ip: string; userAgent?: string },
) {
  const jti = newSessionJti();
  const csrf = randomToken(24);
  const ttlSec = parseInt(env.SESSION_TTL_DAYS || '30', 10) * 24 * 60 * 60;
  const now = Date.now();
  const expiresAt = now + ttlSec * 1000;

  await env.DB.prepare(
    `INSERT INTO sessions (jti, customer_id, csrf_token, user_agent, ip, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(jti, args.customerId, csrf, args.userAgent ?? null, args.ip, expiresAt, now)
    .run();

  const token = await signSession(
    env,
    { sub: args.customerId, email: args.email, jti, csrf },
    ttlSec,
  );
  return { token, csrf, ttlSec, customerId: args.customerId, email: args.email, jti };
}

export async function revokeSession(env: Env, jti: string) {
  await env.DB.prepare(`UPDATE sessions SET revoked_at = ? WHERE jti = ?`)
    .bind(Date.now(), jti)
    .run();
}
