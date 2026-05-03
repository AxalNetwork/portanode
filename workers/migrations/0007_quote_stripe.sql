-- Quote extensions for the formal quote + Stripe Checkout flow.
ALTER TABLE quotes ADD COLUMN contact_country TEXT;
ALTER TABLE quotes ADD COLUMN deployment_site TEXT;
ALTER TABLE quotes ADD COLUMN use_case TEXT;
ALTER TABLE quotes ADD COLUMN vat_id TEXT;
ALTER TABLE quotes ADD COLUMN vat_validated_at INTEGER;
ALTER TABLE quotes ADD COLUMN vat_country TEXT;
ALTER TABLE quotes ADD COLUMN customization_fee_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE quotes ADD COLUMN expedite_fee_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE quotes ADD COLUMN fx_rate REAL NOT NULL DEFAULT 1.0;
-- Snapshot the same fx_rate on the order at creation so the balance invoice
-- and refund reconciliation can convert canonical USD ↔ presentment minor
-- units without re-querying the FX provider.
ALTER TABLE orders ADD COLUMN fx_rate REAL NOT NULL DEFAULT 1.0;
ALTER TABLE quotes ADD COLUMN stripe_checkout_id TEXT;
ALTER TABLE quotes ADD COLUMN stripe_payment_intent_id TEXT;

-- Stripe webhook event ledger for idempotent processing + audit.
CREATE TABLE IF NOT EXISTS stripe_events (
  id            TEXT PRIMARY KEY,        -- stripe event id (evt_...)
  type          TEXT NOT NULL,
  livemode      INTEGER NOT NULL DEFAULT 0,
  received_at   INTEGER NOT NULL,
  processed_at  INTEGER,
  status        TEXT NOT NULL DEFAULT 'received', -- received|processed|failed|ignored
  error         TEXT,
  payload_json  TEXT
);
CREATE INDEX IF NOT EXISTS idx_stripe_events_type ON stripe_events(type);
CREATE INDEX IF NOT EXISTS idx_stripe_events_received ON stripe_events(received_at);

-- Refund ledger (admin-issued, policy-enforced)
CREATE TABLE IF NOT EXISTS refunds (
  id              TEXT PRIMARY KEY,
  order_id        TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  stripe_refund_id TEXT,
  amount_cents    INTEGER NOT NULL,
  currency        TEXT NOT NULL,
  reason          TEXT,
  policy_band     TEXT NOT NULL,           -- 'full'|'half'|'none'|'override'
  status          TEXT NOT NULL DEFAULT 'pending', -- pending|succeeded|failed
  created_by      TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_refunds_order ON refunds(order_id);
