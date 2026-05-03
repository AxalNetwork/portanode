import type { Context } from 'hono';
import type { AppContext, Env } from '../env';

export function setSessionCookie(c: Context<AppContext>, env: Env, token: string, maxAgeSec: number) {
  const secure = env.ENVIRONMENT !== 'development';
  const parts = [
    `${env.SESSION_COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSec}`,
  ];
  if (secure) parts.push('Secure');
  c.header('Set-Cookie', parts.join('; '), { append: true });
}

export function clearSessionCookie(c: Context<AppContext>, env: Env) {
  const secure = env.ENVIRONMENT !== 'development';
  const parts = [
    `${env.SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ];
  if (secure) parts.push('Secure');
  c.header('Set-Cookie', parts.join('; '), { append: true });
}

export function readCookie(c: Context, name: string): string | null {
  const header = c.req.header('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}
