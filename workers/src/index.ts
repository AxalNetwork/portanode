import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { AppContext } from './env';
import { requestContext } from './middleware/request-context';
import { errorHandler, notFoundHandler } from './middleware/error';
import { optionalCustomer } from './middleware/optional-auth';
import { configurations } from './routes/configurations';
import { quotes } from './routes/quotes';
import { leads } from './routes/leads';
import { auth } from './routes/auth';
import { account } from './routes/account';
import { admin } from './routes/admin';
import { stripe } from './routes/stripe';
import { geo } from './routes/geo';
import { runDailyTaskDigest, runWeeklySnapshot } from './services/admin-cron';
import { log } from './lib/log';

const app = new Hono<AppContext>();

app.use('*', requestContext);

// CORS for the public API. The Stripe webhook receiver is exempt: Stripe
// posts server-to-server with no Origin header, signature verification is
// the trust boundary, and CORS preflights would only get in the way.
const corsMiddleware = cors({
  origin: (origin, c) => {
    const allowed = c.env.APP_BASE_URL;
    return origin === allowed ? origin : allowed;
  },
  credentials: true,
  allowHeaders: ['content-type', 'x-csrf-token', 'cf-turnstile-token'],
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  maxAge: 600,
});
app.use('/api/*', async (c, next) => {
  if (c.req.path.startsWith('/api/stripe/webhook')) return next();
  return corsMiddleware(c, next);
});

app.get('/health', (c) =>
  c.json({
    ok: true,
    env: c.env.ENVIRONMENT,
    requestId: c.get('requestId'),
    ts: Date.now(),
  }),
);

// Optional customer attribution on public /api/* (account routes still
// enforce `requireCustomer` themselves). Skipped on the Stripe webhook,
// which is server-to-server and trust-rooted on signature verification.
app.use('/api/*', async (c, next) => {
  if (c.req.path.startsWith('/api/stripe/webhook')) return next();
  return optionalCustomer(c, next);
});

// Public API
app.route('/api/configurations', configurations);
app.route('/api/quotes', quotes);
app.route('/api', leads); // mounts /contact, /leasing, /spec-download
app.route('/api/auth', auth);
// Stripe webhook receiver (signature-verified, no CORS / no rate-limit).
app.route('/api/stripe', stripe);
app.route('/api/geo', geo);

// Authed customer portal
app.route('/api/account', account);

// Admin (login/logout + CRM extras are registered inside `routes/admin.ts`,
// public ones before requireAdmin and protected ones after).
app.route('/admin', admin);

app.notFound(notFoundHandler);
app.onError(errorHandler);

// Cron triggers configured in wrangler.toml. Cloudflare matches against the
// `cron` field; we dispatch by the schedule string so a single Worker can
// host multiple cadences.
export default {
  fetch: app.fetch,
  async scheduled(
    event: { cron: string; scheduledTime: number },
    env: import('./env').Env,
    ctx: ExecutionContext,
  ) {
    const cron = event.cron;
    try {
      if (cron === '0 8 * * *') {
        ctx.waitUntil(runDailyTaskDigest(env).then(() => {}));
      } else if (cron === '0 6 * * 1') {
        ctx.waitUntil(runWeeklySnapshot(env).then(() => {}));
      } else {
        log.warn({ msg: 'cron.unhandled', cron });
      }
    } catch (err) {
      log.error({ msg: 'cron.failed', cron, err: err instanceof Error ? err.message : String(err) });
    }
  },
};
