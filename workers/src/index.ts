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

// Admin
app.route('/admin', admin);

app.notFound(notFoundHandler);
app.onError(errorHandler);

export default app;
