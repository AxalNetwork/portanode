# AXAL Workers Backend

Cloudflare Workers + Hono + D1 + KV + R2 + Resend.

This is the serverless backend that powers the dynamic surface of AXAL:
configuration persistence, quotes, contact/leasing/spec-download leads,
passwordless auth, customer portal data, and admin endpoints. Stripe
checkout glue lands in the next task.

## Layout

```
workers/
├── migrations/                # D1 SQL migrations (see migrations/README.md)
├── scripts/
│   └── build-email-templates.mjs   # MJML → inline HTML compile
├── src/
│   ├── index.ts               # Hono app, route mounting, CORS, error handler
│   ├── env.ts                 # Env + Variables typing
│   ├── lib/                   # ids, jwt, cookies, errors, log, crypto
│   ├── middleware/            # request-context, error, auth, rate-limit, turnstile
│   ├── db/                    # events (audit log) helpers
│   ├── email/                 # send.ts, templates.ts, templates/*.mjml
│   ├── routes/                # configurations, quotes, leads, auth, account, admin
│   ├── services/              # business logic for the routes
│   └── stripe/                # (next task)
├── wrangler.toml
├── tsconfig.json
└── .dev.vars.example
```

## Public API

| Method | Path | Auth |
| --- | --- | --- |
| `POST` | `/api/configurations` | optional customer |
| `GET`  | `/api/configurations/:id` | optional customer (owned configs) |
| `POST` | `/api/quotes` | turnstile + optional customer |
| `GET`  | `/api/quotes/:id` | optional customer (owned quotes) |
| `POST` | `/api/contact` | turnstile, 3/min/IP |
| `POST` | `/api/leasing` | turnstile, 3/min/IP |
| `POST` | `/api/spec-download` | turnstile, 3/min/IP |
| `POST` | `/api/auth/magic-link` | turnstile, 5/5min/IP |
| `GET`  | `/api/auth/magic` | (consumes single-use token) |
| `GET`  | `/api/auth/me` | customer cookie |
| `POST` | `/api/auth/logout` | customer cookie |

## Customer portal API (cookie + CSRF header)

- `GET /api/account/orders`
- `GET /api/account/orders/:id`
- `POST /api/account/orders/:id/notes`
- `GET /api/account/quotes`
- `GET /api/account/invoices/:id`

State-changing portal calls require the `x-csrf-token` header; clients
read the value from `GET /api/auth/me`.

## Admin API (`Authorization: Bearer <ADMIN_API_TOKEN>`)

- `GET /admin/dashboard`
- `GET /admin/orders` · `GET /admin/orders/:id` · `PATCH /admin/orders/:id`
- `POST /admin/orders/:id/invoice-balance`
- `POST /admin/refunds`
- `GET /admin/quotes`
- `GET /admin/leads`

## Design notes

**CSRF on public POSTs when a session cookie is present.** The
`optionalCustomer` middleware on `/api/*` enforces the `x-csrf-token`
header on any unsafe method (`POST`/`PATCH`/`DELETE`) whenever a valid
session cookie is attached. Anonymous callers (no cookie) are
unaffected. This is intentional: it prevents a third-party origin from
silently using a logged-in customer's cookie to create configurations,
quotes, or leads on their behalf. **Frontend clients must call
`GET /api/auth/me` after login and echo the returned `csrfToken` on every
state-changing call** — including the public POSTs (`/api/configurations`,
`/api/quotes`, `/api/contact`, `/api/leasing`, `/api/spec-download`).
Anonymous form posts continue to work without the header.

**Email rendering uses the runtime templates in `src/email/templates.ts`,
not the MJML-compiled output.** This keeps the worker bundle small and
free of MJML's runtime, while the `npm run build:email` step still
validates that all MJML sources compile cleanly at deploy time and
publishes them to `src/email/compiled/` for QA / external preview tools.
The runtime fallbacks are hand-tuned to match the same brand tokens. To
switch to compiled artifacts at runtime, import them in `templates.ts`
and replace each branch — the `vars` contract is identical.

## Conventions

- **Errors** always return `{ error: { code, message, details?, requestId } }`
  with a stable `code`. Stack traces never leak.
- **Logging** is structured JSON (`level`, `ts`, `msg`, `requestId`, …). No
  PII bodies, no secrets.
- **Audit log:** every state-changing service writes a row to `events` via
  `db/events.logEvent` (append-only).
- **Money:** integer cents, currency string. **Timestamps:** Unix ms.
- **IDs:** see `lib/ids.ts` (nanoid alphabets, `Q-`/`O-` prefixes).
- **Auth:** Resend magic link → click-through `GET /api/auth/magic` exchanges
  the single-use token for an HttpOnly `axal_session` cookie (HS256 JWT, 30d
  TTL). CSRF token is per-session.
- **Rate limits:** `RL_CONTACT` 3/min, `RL_CONFIG` 60/min, `RL_AUTH` 5/5min,
  keyed by `IP + path` via the Cloudflare unsafe ratelimit binding.
- **Turnstile:** verified server-side on every public POST (skipped in
  `ENVIRONMENT=development` with the test secret).

## Local development

```bash
cp .dev.vars.example .dev.vars   # fill JWT_SECRET, ADMIN_API_TOKEN, etc.
npm install
npm run migrate:local            # apply D1 migrations to local sqlite
npm run dev                      # wrangler dev → http://localhost:8787
```

In dev mode, Resend calls are dry-run (logged, not sent) so the magic-link
flow works without an outbound provider — copy the link from the worker
console.

## Deploy (staging)

```bash
# one-time
wrangler d1 create axal-db-staging
wrangler kv namespace create axal-cache --env staging
wrangler r2 bucket create axal-assets-staging
# then update the IDs in wrangler.toml [env.staging]

wrangler secret put JWT_SECRET --env staging
wrangler secret put RESEND_API_KEY --env staging
wrangler secret put TURNSTILE_SECRET_KEY --env staging
wrangler secret put ADMIN_API_TOKEN --env staging

npm run migrate:staging          # applies D1 migrations to staging
npm run deploy:staging
```

`STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are wired up but unused —
the Stripe checkout + webhook flow is the next task.
