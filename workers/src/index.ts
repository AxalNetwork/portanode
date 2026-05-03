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

const app = new Hono<AppContext>();

app.use('*', requestContext);
app.use(
  '/api/*',
  cors({
    origin: (origin, c) => {
      const allowed = c.env.APP_BASE_URL;
      return origin === allowed ? origin : allowed;
    },
    credentials: true,
    allowHeaders: ['content-type', 'x-csrf-token', 'cf-turnstile-token'],
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    maxAge: 600,
  }),
);

app.get('/health', (c) =>
  c.json({
    ok: true,
    env: c.env.ENVIRONMENT,
    requestId: c.get('requestId'),
    ts: Date.now(),
  }),
);

// Optional customer attribution on public /api/* (account routes still
// enforce `requireCustomer` themselves).
app.use('/api/*', optionalCustomer);

// Public API
app.route('/api/configurations', configurations);
app.route('/api/quotes', quotes);
app.route('/api', leads); // mounts /contact, /leasing, /spec-download
app.route('/api/auth', auth);

// Authed customer portal
app.route('/api/account', account);

// Admin
app.route('/admin', admin);

app.notFound(notFoundHandler);
app.onError(errorHandler);

export default app;
