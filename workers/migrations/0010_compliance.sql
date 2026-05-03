-- Compliance: export controls, sanctions screening, KYB threshold review.
--
-- 1) `sanctions_screenings` — every customer creation triggers a screen
--    against OFAC SDN / EU consolidated / UK sanctions / UN consolidated
--    via the OpenSanctions API (or a stub when the key is absent). Hits are
--    persisted with the matched entity name + score so the admin can review.
--    `status` transitions: pending → cleared | matched | escalated.
CREATE TABLE IF NOT EXISTS sanctions_screenings (
  id            TEXT PRIMARY KEY,
  customer_id   TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'pending',
  query_name    TEXT NOT NULL,
  query_country TEXT,
  match_count   INTEGER NOT NULL DEFAULT 0,
  top_score     REAL,
  matches_json  TEXT,                       -- raw provider matches for review
  provider      TEXT NOT NULL DEFAULT 'opensanctions',
  reviewed_by   TEXT,
  reviewed_at   INTEGER,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sanctions_customer ON sanctions_screenings(customer_id);
CREATE INDEX IF NOT EXISTS idx_sanctions_status   ON sanctions_screenings(status);

-- 2) Sanctions flag mirrored on the customer for fast lookup at checkout
--    time (the screening row is the audit record). `sanctions_status`
--    values: clear | review | blocked.
ALTER TABLE customers ADD COLUMN sanctions_status TEXT NOT NULL DEFAULT 'clear';
ALTER TABLE customers ADD COLUMN sanctions_reviewed_at INTEGER;

-- 3) KYB hold on orders that exceed the configured threshold (default
--    $250k). When held, the order sits in `kyb_status = 'pending'` until
--    ops clears it via the admin console. The status doesn't replace the
--    fulfilment status; it gates the production line specifically.
ALTER TABLE orders ADD COLUMN kyb_status TEXT NOT NULL DEFAULT 'not_required';
--   ^ values: not_required | pending | cleared | rejected
ALTER TABLE orders ADD COLUMN kyb_provider_ref TEXT;
ALTER TABLE orders ADD COLUMN kyb_reviewed_at INTEGER;
ALTER TABLE orders ADD COLUMN kyb_reviewed_by TEXT;
CREATE INDEX IF NOT EXISTS idx_orders_kyb_status ON orders(kyb_status);

-- 4) Restricted-country block log. Whenever the country gate denies a
--    checkout we record a row so ops can see geographic demand and flag
--    polite outreach for legitimate restricted-territory customers.
CREATE TABLE IF NOT EXISTS restricted_blocks (
  id            TEXT PRIMARY KEY,
  country       TEXT NOT NULL,
  list_source   TEXT NOT NULL,             -- 'default' | 'kv'
  context       TEXT NOT NULL,             -- 'checkout' | 'quote' | 'lead'
  customer_id   TEXT,
  email         TEXT,
  request_id    TEXT,
  ip            TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_restricted_blocks_country ON restricted_blocks(country);
CREATE INDEX IF NOT EXISTS idx_restricted_blocks_created ON restricted_blocks(created_at);
