-- Quotes: priced offers tied to a configuration
CREATE TABLE IF NOT EXISTS quotes (
  id              TEXT PRIMARY KEY,        -- short id, e.g. Q-AB12CD34
  customer_id     TEXT REFERENCES customers(id) ON DELETE SET NULL,
  configuration_id TEXT NOT NULL REFERENCES configurations(id) ON DELETE RESTRICT,
  status          TEXT NOT NULL DEFAULT 'draft', -- draft|sent|accepted|expired|cancelled
  contact_email   TEXT NOT NULL,
  contact_name    TEXT,
  contact_company TEXT,
  contact_phone   TEXT,
  region          TEXT NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'USD',
  subtotal_cents  INTEGER NOT NULL,
  freight_cents   INTEGER NOT NULL DEFAULT 0,
  tax_cents       INTEGER NOT NULL DEFAULT 0,
  total_cents     INTEGER NOT NULL,
  deposit_cents   INTEGER NOT NULL DEFAULT 0,
  notes           TEXT,
  pdf_r2_key      TEXT,
  expires_at      INTEGER NOT NULL,
  sent_at         INTEGER,
  accepted_at     INTEGER,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_quotes_customer ON quotes(customer_id);
CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status);
CREATE INDEX IF NOT EXISTS idx_quotes_created ON quotes(created_at);

-- Orders: live commitments with payment status
CREATE TABLE IF NOT EXISTS orders (
  id                  TEXT PRIMARY KEY,    -- short id, e.g. O-AB12CD34
  customer_id         TEXT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  quote_id            TEXT REFERENCES quotes(id) ON DELETE SET NULL,
  configuration_id    TEXT NOT NULL REFERENCES configurations(id) ON DELETE RESTRICT,
  status              TEXT NOT NULL DEFAULT 'awaiting_deposit',
                      -- awaiting_deposit|in_production|shipping|delivered|cancelled|refunded
  region              TEXT NOT NULL,
  currency            TEXT NOT NULL DEFAULT 'USD',
  subtotal_cents      INTEGER NOT NULL,
  freight_cents       INTEGER NOT NULL DEFAULT 0,
  tax_cents           INTEGER NOT NULL DEFAULT 0,
  total_cents         INTEGER NOT NULL,
  deposit_cents       INTEGER NOT NULL,
  deposit_paid_cents  INTEGER NOT NULL DEFAULT 0,
  balance_paid_cents  INTEGER NOT NULL DEFAULT 0,
  refunded_cents      INTEGER NOT NULL DEFAULT 0,
  stripe_customer_id  TEXT,
  stripe_checkout_id  TEXT,
  stripe_payment_intent_id TEXT,
  shipping_address_json TEXT,
  expected_ship_at    INTEGER,
  shipped_at          INTEGER,
  delivered_at        INTEGER,
  cancelled_at        INTEGER,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);

-- Per-order notes (customer + admin) and invoice records
CREATE TABLE IF NOT EXISTS order_notes (
  id          TEXT PRIMARY KEY,
  order_id    TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  author_kind TEXT NOT NULL,           -- 'customer' | 'admin'
  author_id   TEXT,
  body        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_order_notes_order ON order_notes(order_id);

CREATE TABLE IF NOT EXISTS invoices (
  id              TEXT PRIMARY KEY,
  order_id        TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL,         -- 'deposit' | 'balance' | 'refund'
  amount_cents    INTEGER NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'USD',
  stripe_invoice_id TEXT,
  pdf_r2_key      TEXT,
  issued_at       INTEGER NOT NULL,
  paid_at         INTEGER,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invoices_order ON invoices(order_id);
