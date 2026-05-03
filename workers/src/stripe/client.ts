/**
 * Minimal Stripe REST client that runs on Workers (no Node SDK). We pass
 * `application/x-www-form-urlencoded` bodies and accept deeply nested keys
 * via dot-bracket notation, which is Stripe's standard form encoding.
 *
 * Idempotency keys are required on every write — callers pass a deterministic
 * key tied to (resource, action) so retries collapse server-side.
 */
import type { Env } from '../env';
import { Errors } from '../lib/errors';
import { log } from '../lib/log';

export interface StripeRequestOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  idempotencyKey?: string;
  query?: Record<string, string | number | undefined>;
}

export interface StripeError {
  type?: string;
  code?: string;
  message?: string;
  param?: string;
}

export class StripeApiError extends Error {
  status: number;
  body: { error?: StripeError } | null;
  constructor(status: number, body: { error?: StripeError } | null) {
    super(body?.error?.message ?? `Stripe API error ${status}`);
    this.status = status;
    this.body = body;
  }
}

function flatten(obj: unknown, prefix = '', out: [string, string][] = []): [string, string][] {
  if (obj === null || obj === undefined) return out;
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out));
    return out;
  }
  if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const next = prefix ? `${prefix}[${k}]` : k;
      flatten(v, next, out);
    }
    return out;
  }
  out.push([prefix, String(obj)]);
  return out;
}

export function stripeForm(body: Record<string, unknown>): string {
  return flatten(body)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

export async function stripeRequest<T>(
  env: Env,
  path: string,
  body: Record<string, unknown> | null = null,
  opts: StripeRequestOptions = {},
): Promise<T> {
  const key = env.STRIPE_SECRET_KEY;
  if (!key) throw Errors.internal('Stripe is not configured');

  const method = opts.method ?? (body ? 'POST' : 'GET');
  const headers: Record<string, string> = {
    authorization: `Bearer ${key}`,
    'stripe-version': '2024-11-20.acacia',
  };
  if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey;

  let url = `https://api.stripe.com${path}`;
  if (opts.query) {
    const qs = Object.entries(opts.query)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
    if (qs) url += `?${qs}`;
  }

  let payload: string | undefined;
  if (body) {
    payload = stripeForm(body);
    headers['content-type'] = 'application/x-www-form-urlencoded';
  }

  const res = await fetch(url, { method, headers, body: payload });
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!res.ok) {
    log.warn({
      msg: 'stripe.error',
      path,
      status: res.status,
      err: (json as { error?: StripeError } | null)?.error?.message,
    });
    throw new StripeApiError(res.status, json as { error?: StripeError } | null);
  }
  return json as T;
}
