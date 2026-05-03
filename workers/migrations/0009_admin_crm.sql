-- Admin panel & lightweight CRM extensions.
--
-- 1) `customer_notes` — free-text timestamped notes attached to a customer
--    by an admin. Distinct from `order_notes` (which are scoped to an order
--    and visible to the customer in the portal). These are admin-only and
--    visible only behind the admin auth gate.
CREATE TABLE IF NOT EXISTS customer_notes (
  id          TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  author_id   TEXT,                       -- admin token hash prefix
  body        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_customer_notes_customer ON customer_notes(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_notes_created ON customer_notes(created_at);

-- 2) `admin_tasks` — operational task list. Either standalone (general ops
--    todos) or attached to a customer / order. The daily cron Worker reads
--    this table and emails ops@ with overdue + due-today tasks.
CREATE TABLE IF NOT EXISTS admin_tasks (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  description   TEXT,
  customer_id   TEXT REFERENCES customers(id) ON DELETE SET NULL,
  order_id      TEXT REFERENCES orders(id) ON DELETE SET NULL,
  due_at        INTEGER,                  -- ms epoch; null means no deadline
  completed_at  INTEGER,
  created_by    TEXT,                     -- admin token hash prefix
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_tasks_due ON admin_tasks(due_at);
CREATE INDEX IF NOT EXISTS idx_admin_tasks_customer ON admin_tasks(customer_id);
CREATE INDEX IF NOT EXISTS idx_admin_tasks_completed ON admin_tasks(completed_at);

-- 3) `pricing_snapshots` — point-in-time copies of `_data/catalog.json` so
--    the admin pricing-review tool can diff current pricing against the
--    last quarter. The `taken_at` column is the snapshot timestamp; ops
--    invokes `POST /admin/pricing/snapshot` quarterly (or on demand) and
--    the diff endpoint joins the two most recent rows.
CREATE TABLE IF NOT EXISTS pricing_snapshots (
  id            TEXT PRIMARY KEY,
  taken_at      INTEGER NOT NULL,
  catalog_version TEXT,
  payload_json  TEXT NOT NULL,
  created_by    TEXT,
  notes         TEXT
);
CREATE INDEX IF NOT EXISTS idx_pricing_snapshots_taken ON pricing_snapshots(taken_at);

-- 4) `admin_sessions` — short-lived cookie sessions issued by the admin
--    login endpoint. We hash the cookie token (SHA-256 hex) so a DB read
--    can never reveal a live cookie value. Basic auth gating is applied at
--    the Cloudflare edge separately; this cookie is the second factor that
--    authorises individual API calls without re-prompting on every request.
CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash    TEXT PRIMARY KEY,
  label         TEXT,                     -- optional (e.g. user note)
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  last_used_at  INTEGER,
  revoked_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON admin_sessions(expires_at);
