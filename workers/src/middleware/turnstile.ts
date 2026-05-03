import type { MiddlewareHandler } from 'hono';
import type { AppContext } from '../env';
import { Errors } from '../lib/errors';

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export const turnstile: MiddlewareHandler<AppContext> = async (c, next) => {
  // Allow skip in dev when no key is configured.
  if (!c.env.TURNSTILE_SECRET_KEY || c.env.TURNSTILE_SECRET_KEY.startsWith('0x4AAAAAAA-test')) {
    if (c.env.ENVIRONMENT === 'development') return next();
  }

  const token =
    c.req.header('cf-turnstile-token') ??
    (await readTokenFromBody(c.req.raw.clone()));
  if (!token) throw Errors.badRequest('Missing Turnstile token');

  const form = new FormData();
  form.append('secret', c.env.TURNSTILE_SECRET_KEY);
  form.append('response', token);
  form.append('remoteip', c.get('ip') ?? '');

  const res = await fetch(TURNSTILE_VERIFY_URL, { method: 'POST', body: form });
  const data = (await res.json()) as { success: boolean; 'error-codes'?: string[] };
  if (!data.success) throw Errors.forbidden('Turnstile verification failed');
  return next();
};

async function readTokenFromBody(req: Request): Promise<string | null> {
  try {
    const ct = req.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) {
      const body = (await req.json()) as { turnstileToken?: string };
      return body.turnstileToken ?? null;
    }
    if (ct.includes('form')) {
      const fd = await req.formData();
      return (fd.get('cf-turnstile-response') as string) ?? null;
    }
  } catch {
    /* ignore */
  }
  return null;
}
