/**
 * Stripe webhook signature verification + event dispatch.
 *
 * Verification follows Stripe's standard scheme: header is
 * `t=<timestamp>,v1=<hex>` and we recompute HMAC-SHA256 of `<t>.<rawbody>`
 * with the webhook secret, comparing in constant time. Tolerance is 5
 * minutes by default to account for clock skew.
 */
import type { Env } from '../env';
import { timingSafeEqual } from '../lib/crypto';

const enc = new TextEncoder();

export interface StripeEvent {
  id: string;
  type: string;
  livemode: boolean;
  data: { object: Record<string, unknown> };
  created: number;
}

export interface VerifyResult {
  ok: boolean;
  event?: StripeEvent;
  error?: string;
}

export async function verifyWebhook(
  env: Env,
  rawBody: string,
  signatureHeader: string | null,
  toleranceSec = 300,
): Promise<VerifyResult> {
  if (!env.STRIPE_WEBHOOK_SECRET) return { ok: false, error: 'webhook secret not configured' };
  if (!signatureHeader) return { ok: false, error: 'missing signature' };

  const parts = signatureHeader.split(',').reduce<Record<string, string[]>>((acc, kv) => {
    const [k, v] = kv.trim().split('=');
    if (!k || !v) return acc;
    (acc[k] ||= []).push(v);
    return acc;
  }, {});
  const t = parts['t']?.[0];
  const sigs = parts['v1'] ?? [];
  if (!t || sigs.length === 0) return { ok: false, error: 'malformed signature header' };

  const ageSec = Math.abs(Date.now() / 1000 - Number(t));
  if (!Number.isFinite(ageSec) || ageSec > toleranceSec) {
    return { ok: false, error: 'timestamp outside tolerance' };
  }

  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(env.STRIPE_WEBHOOK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${rawBody}`)),
  );
  const expected = Array.from(mac)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const matched = sigs.some((s) => s.length === expected.length && timingSafeEqual(s, expected));
  if (!matched) return { ok: false, error: 'signature mismatch' };

  let event: StripeEvent;
  try {
    event = JSON.parse(rawBody) as StripeEvent;
  } catch {
    return { ok: false, error: 'invalid json' };
  }
  return { ok: true, event };
}
