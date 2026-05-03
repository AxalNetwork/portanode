# AXAL — Modular Infrastructure eCommerce

## Project Overview
AXAL is a Jekyll + Tailwind static site for a modular infrastructure eCommerce
platform. Customers browse modules, compose them into stacks, configure, and
purchase. This repo currently contains the brand foundation and theme shell.

## Architecture
- **Framework**: Jekyll 4.3.x (Ruby static site generator)
- **CSS**: Tailwind CSS 3 (compiled via npm/`tailwindcss` CLI)
- **Hosting target**: Static (GitHub Pages / Cloudflare Pages compatible)

## Brand
- Purple palette: `#6B21A8`, `#A855F7`, `#C084FC`
- Off-black ink `#0B0B0F`, paper white `#FAFAF7`, technical gray `#6B7280`
- Typography: Geist / Inter (sans), JetBrains Mono (mono), self-host via
  `assets/fonts/` (see `assets/fonts/README.md`)

## Plugins
- `jekyll-feed`, `jekyll-seo-tag`, `jekyll-sitemap`, `jekyll-redirect-from`,
  `jekyll-include-cache`

## Configurator
Interactive Svelte + Vite app at `/configure/`. Source in `configurator/`,
build outputs `assets/configurator/bundle.{js,css}` plus a lazy three.js
chunk and copies of `catalog.json` / `stacks.json`. Build with:
```bash
cd configurator && npm install && npm run build
```

## Customer portal
Logged-in customer area at `/account/` (Jekyll page → Svelte SPA mounted at
`#axal-account`). Source in `account/`, builds to
`assets/account/bundle.{js,css}` (≤ 90 KB JS budget). Hash-based router
(`#/dashboard`, `#/orders/:id`, `#/quotes`, `#/configurations`, `#/profile`,
`#/privacy`). Auth flow: magic-link via `/api/auth/magic-link` →
`/api/auth/magic` sets the `axal_session` cookie, the SPA reads CSRF from
`/api/auth/me`. Backend routes in `workers/src/routes/account.ts` cover
orders + timeline + ops messages, quotes (with portal-authenticated Stripe
Checkout that bypasses the signed-link token), saved configurations
(list / duplicate / deep-link edit), profile (mirrors to Stripe customer),
and privacy self-service (`POST /export` returns full JSON; `POST /delete`
queues an erasure request). Migration `0008_account_portal.sql` adds
billing/shipping/contacts/VAT columns to `customers`, the `stripe_customer_id`
column, and the `privacy_requests` ledger.

Three-column shell, click-a-module option modal, pure constraint engine
(requires/excludes/region/power/footprint), short-id save+share via
localStorage stub, deep-link entries `?c=`, `?stack=`, `?module=`.

## Backend (`workers/`)
Cloudflare Workers + Hono + D1 + KV + R2 + Resend. Powers configuration
persistence, quotes, leads (contact / leasing / spec-download), passwordless
customer auth (magic link → HttpOnly JWT cookie + CSRF), customer portal
endpoints, and admin endpoints gated by `ADMIN_API_TOKEN`. D1 migrations in
`workers/migrations/` cover `customers`, `magic_links`, `sessions`,
`configurations`, `quotes`, `orders`, `order_notes`, `invoices`, `events`
(append-only audit log), `leads`, `email_subscriptions`, and
`manufacturing_capacity`. Email service in `workers/src/email/` ships hand-
tuned inline HTML in the runtime plus MJML sources compiled at deploy time.
Turnstile + Cloudflare unsafe rate-limit bindings guard public POSTs.
Local dev: `cd workers && cp .dev.vars.example .dev.vars && npm install &&
npm run migrate:local && npm run dev`.

### Quote & Stripe Checkout flow
- `POST /api/quotes` collects company / contact / country / deployment site
  / use case / optional VAT ID; persists to D1, validates EU VAT IDs against
  VIES, FX-converts the canonical USD pricing into the customer's local
  currency (Stripe-supported subset, daily-cached in KV at `fx:usd:v1`), and
  emails a 30-day signed link via Resend.
- `/quote/?id=&t=` is the customer-facing review page (`pages/quote.html`)
  that hydrates from `GET /api/quotes/:id?t=…` and offers a printable PDF
  (`/api/quotes/:id/pdf` — Browser Rendering when `BROWSER` is bound, otherwise
  printable HTML cached to R2 at `quotes/{id}.pdf`).
- `POST /api/quotes/:id/checkout` builds a Stripe Checkout Session in
  `payment` mode for the 20% deposit with billing + shipping address required,
  Stripe Tax + tax-id collection on, multi-method (card, ACH for USD, SEPA for
  EUR, customer-balance bank transfer where supported). Idempotency key:
  `axal:quote:{id}:checkout:v1`.
- `POST /api/stripe/webhook` verifies `Stripe-Signature` (HMAC-SHA256 over
  `t.body`, ±5 min tolerance), persists each event to `stripe_events` for
  idempotent dispatch, and handles `checkout.session.completed`,
  `payment_intent.succeeded|payment_failed`, `invoice.paid|payment_failed`,
  `charge.refunded`, `charge.dispute.created`. On checkout completion an
  order is materialized (status `reserved`), the customer is upserted, the
  quote is marked accepted, and a deposit-received email is sent.
- Admin endpoints: `POST /admin/orders/:id/invoice-balance` creates Stripe
  invoice items + finalized invoice for the manual 80% balance billing;
  `POST /admin/refunds` enforces the policy bands (100% within 14 days, 50%
  within 30, 0% once `in_production`/`shipping`/`delivered`) with optional
  `override` flag, and executes the Stripe refund. All Stripe writes use
  deterministic idempotency keys.
- Migration `0007_quote_stripe.sql` adds quote contact-detail / FX / VAT /
  Stripe linkage columns and creates `stripe_events` (event ledger) +
  `refunds` (admin refund ledger).

## Admin console
Internal ops console at `/admin/` (Cloudflare basic-auth at the edge is the
outer gate; the SPA additionally requires the `axal_admin` HttpOnly cookie
issued by `POST /admin/login` after presenting the `ADMIN_API_TOKEN`). Source
in `admin/`, builds to `assets/admin/bundle.{js,css}`. Hash-router views:
- `#/dashboard` — funnel counts, weekly leads/quotes/orders, deposit
  pipeline, leads-by-source / orders-by-status tables, manual cron triggers
- `#/inbox` — leads from contact / leasing / spec / newsletter / demo with
  inline status updates (PATCH `/admin/leads/:id`)
- `#/pipeline` — 8-column Kanban (Lead → Qualified → Quote sent →
  Awaiting deposit → In production → Shipping → Delivered → Closed). Quote
  columns are read-only; order columns accept HTML5 drag-drop and call
  `PATCH /admin/orders/:id`.
- `#/customers` and `#/customers/:id` — search + 360° view: orders, quotes,
  configurations, tasks, timestamped notes (CRM), and a 50-row event timeline.
- `#/orders/:id` — money breakdown, status switcher, tracking edit, balance
  invoice (`POST /admin/orders/:id/invoice-balance`), and policy-band refund
  (`POST /admin/refunds`) with optional override and amount.
- `#/tasks` — open / overdue / completed lists with linkable customer and
  order references. Daily 08:00 UTC cron (`runDailyTaskDigest` in
  `workers/src/services/admin-cron.ts`) emails an HTML+text digest of
  overdue + due-today tasks via `email/raw.ts` to `EMAIL_REPLY_TO`.
- `#/pricing` — quarterly snapshots of `_data/catalog.json`. The SPA fetches
  `/assets/configurator/catalog.json` (or `/_data/catalog.json`) and POSTs
  to `/admin/pricing/diff` to render added / removed / changed module prices
  + per-option deltas. Snapshots persist to `pricing_snapshots` (D1).
- `#/exports` — CSV bundle of customers, leads, quotes, orders, invoices,
  refunds, notes, and tasks. Stored at `admin-exports/{YYYY-MM-DD}.csv` and
  `admin-exports/latest.csv` in R2. Weekly cron `0 6 * * 1` rebuilds the
  latest snapshot.

Backend in `workers/src/routes/admin-extra.ts` (login/logout/me, customers,
notes, leads PATCH, tasks, pricing, exports, manual cron triggers) and
`workers/src/services/{crm,pricing-review,admin-export,admin-cron}.ts`. The
`requireAdmin` middleware accepts either `Bearer ADMIN_API_TOKEN` (scripts)
or the `axal_admin` cookie tracked in `admin_sessions` (12 h TTL, hashed
with SHA-256, `last_used_at` bumped on each request). Migration
`0009_admin_crm.sql` adds `customer_notes`, `admin_tasks`, `pricing_snapshots`,
`admin_sessions`. Cron triggers configured in `wrangler.toml`
`[triggers].crons = ["0 8 * * *", "0 6 * * 1"]` and dispatched by
`event.cron` in the `scheduled` handler in `workers/src/index.ts`. Build:
`cd admin && npm install && npm run build`.

## Catalog data
Canonical product data lives in `_data/`:
- `catalog.json` — 8 modules with `basePrice`, `dimensions`, `weight`, `power`,
  `leadTimeWeeks`, `regions[]`, `interconnects[]`, and grouped `options[]`
  (each with `priceDelta`, `requires[]`, `excludes[]`)
- `stacks.json` — 7 launch stacks pointing at module ids + default options
- `promotions.json` — placeholder array for regional / launch promos
- `catalog.schema.json` — JSON Schema validating `catalog.json`

Validate locally: `npm run validate:catalog` (also runs as `prebuild:css`
hook). Module/stack pages and listing cards read prices and option summaries
from these files via `_includes/catalog-price.html`,
`_includes/stack-price.html`, and `_includes/module-options.html`. No prices
are hard-coded in module/stack markdown frontmatter.

## Collections
- `_modules/` → `/modules/:slug/` — 8 modules (Core, Volt, Flow, Grow, Shell, Cycle, Care, Learn)
- `_stacks/` → `/stacks/:slug/` — 7 reference stacks
- `_use_cases/` → `/use-cases/:slug/` — 9 industry pages
- `_specs/` (data only, not output)
- `_legal/` → `/legal/:slug/` — 5 legal docs (terms-of-sale, privacy, refund, export, cookies)
- `_posts/` — 6 launch blog posts

## Static pages (in `pages/`)
`/modules/`, `/stacks/`, `/use-cases/`, `/specs/` (gated download form),
`/sustainability/`, `/shipping/` (SVG world tier map), `/financing/`,
`/about/`, `/blog/`

## Layouts
`default.html` → `page.html` / `module.html` / `stack.html` / `post.html` /
`legal.html`

## Includes
`head.html`, `header.html`, `footer.html`, `cta.html`, `module-card.html`,
`stack-card.html`, `spec-table.html`, `price-display.html`, `cookie-banner.html`,
`analytics.html`, `logo.html`

## Assets
- `assets/css/tailwind.src.css` — Tailwind source (with `@layer components`)
- `assets/css/tailwind.css` — compiled, **committed** for static hosting
- `assets/logos/` — SVG logo variants (lockup, wordmark, monogram, knockout, favicon)
- `assets/fonts/` — drop self-hosted woff2 files here
- `scripts/optimize-images.sh` — `cwebp` / `avifenc` / `svgo` helper

## Development
```bash
bundle install                 # one-time
npm install                    # one-time
npm run watch:css              # rebuild Tailwind on change
bundle exec jekyll serve --host 0.0.0.0 --port 5000 --livereload
```

After changing template classes, rebuild the CSS:
```bash
npm run build:css
```

## Deployment
- **Type**: Static site
- **Build**: `npm run build:css && bundle exec jekyll build`
- **Public dir**: `_site`
- Port: 5000 (dev)
