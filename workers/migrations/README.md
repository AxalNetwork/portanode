# D1 Schema (`axal-db`)

Migrations are applied in order by filename. Run with:

```bash
npm run migrate:local      # against the local Wrangler-managed SQLite
npm run migrate:remote     # against the bound Cloudflare D1 database
```

## Tables

| Migration | Tables |
| --- | --- |
| `0001_customers.sql` | `customers`, `magic_links`, `sessions` |
| `0002_configurations.sql` | `configurations` |
| `0003_quotes_orders.sql` | `quotes`, `orders`, `order_notes`, `invoices` |
| `0004_events_audit.sql` | `events` (append-only audit log) |
| `0005_leads_subscriptions.sql` | `leads`, `email_subscriptions` |
| `0006_manufacturing_capacity.sql` | `manufacturing_capacity` |

### Conventions

- All timestamps are **Unix milliseconds (`INTEGER`)**, not ISO strings, so
  D1 indices stay narrow and date math is cheap.
- All money is stored as **integer cents** in `*_cents` columns, never
  floats. Display formatting happens in the UI.
- All ids are short, URL-safe nanoids:
  - configurations: 10 chars (`abc123XYZ_`)
  - quotes: prefixed `Q-` + 8 chars
  - orders: prefixed `O-` + 8 chars
  - events / order_notes / invoices / leads: 12 chars
- The `events` table is **append-only**. Never `UPDATE` or `DELETE` rows
  here — it is the audit log of record. Every email send, payment
  webhook, admin action, and customer state change writes an event row.
- `magic_links.token_hash` stores a SHA-256 hex of the secret token, never
  the raw token. The token itself only ever appears in the email body.
- `sessions.csrf_token` is a per-session value rotated on login. Every
  state-changing portal/admin call must echo it via the `x-csrf-token`
  header (see `src/middleware/auth.ts`).

### Migration workflow

1. Create a new file `NNNN_short_description.sql` with monotonically
   increasing `NNNN`.
2. Use `CREATE TABLE IF NOT EXISTS` and idempotent `CREATE INDEX IF NOT
   EXISTS` so re-running is safe.
3. Document the table here.
4. Apply locally, run `npm run typecheck`, ship.
