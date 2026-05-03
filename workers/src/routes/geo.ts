/**
 * Tiny endpoint that surfaces the request's Cloudflare-derived country (ISO-2)
 * to the static frontend. Used to prefill the formal-quote form's country
 * field per the multi-currency acceptance criteria (currency auto-detected
 * from `cf.country` with manual override).
 *
 * Cached for 60s at the edge; never sets a cookie or returns user-specific
 * data, so it's safe to share across visitors with the same Cloudflare PoP.
 */
import { Hono } from 'hono';
import type { AppContext } from '../env';

export const geo = new Hono<AppContext>();

geo.get('/', (c) => {
  const cf = (c.req.raw as Request & { cf?: { country?: string } }).cf;
  const country = (cf?.country ?? c.req.header('cf-ipcountry') ?? '').toUpperCase();
  c.header('cache-control', 'public, max-age=60');
  return c.json({ data: { country: country || null } });
});
