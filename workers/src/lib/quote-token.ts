/**
 * HMAC-signed tokens for shareable quote URLs. The token encodes the quote
 * id and an expiry (matching the quote's 30-day validity). Verifying only
 * requires the JWT secret — no DB column. Constant-time comparison.
 */
import type { Env } from '../env';

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromB64url(s: string): Uint8Array {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const b = atob(s.replaceAll('-', '+').replaceAll('_', '/') + pad);
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

async function hmacKey(env: Env): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    enc.encode(env.JWT_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function signQuoteToken(env: Env, quoteId: string, expiresAtMs: number): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify({ q: quoteId, exp: expiresAtMs })));
  const key = await hmacKey(env);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(payload)));
  return `${payload}.${b64url(sig)}`;
}

export async function verifyQuoteToken(
  env: Env,
  token: string,
): Promise<{ quoteId: string; expiresAt: number } | null> {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const key = await hmacKey(env);
  const ok = await crypto.subtle.verify('HMAC', key, fromB64url(sig), enc.encode(payload));
  if (!ok) return null;
  let body: { q?: string; exp?: number };
  try {
    body = JSON.parse(new TextDecoder().decode(fromB64url(payload)));
  } catch {
    return null;
  }
  if (!body.q || !body.exp) return null;
  if (body.exp < Date.now()) return null;
  return { quoteId: body.q, expiresAt: body.exp };
}
