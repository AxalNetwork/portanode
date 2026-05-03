-- Customers: portal accounts (passwordless via magic link)
CREATE TABLE IF NOT EXISTS customers (
  id              TEXT PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,
  name            TEXT,
  company         TEXT,
  phone           TEXT,
  region          TEXT,
  marketing_opt_in INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  last_login_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);

-- Magic-link tokens (single-use, short TTL)
CREATE TABLE IF NOT EXISTS magic_links (
  token_hash      TEXT PRIMARY KEY,
  email           TEXT NOT NULL,
  customer_id     TEXT,
  redirect_to     TEXT,
  expires_at      INTEGER NOT NULL,
  consumed_at     INTEGER,
  created_ip      TEXT,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_magic_links_email ON magic_links(email);
CREATE INDEX IF NOT EXISTS idx_magic_links_expires ON magic_links(expires_at);

-- Sessions: server-side session records keyed by JWT jti
CREATE TABLE IF NOT EXISTS sessions (
  jti             TEXT PRIMARY KEY,
  customer_id     TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  csrf_token      TEXT NOT NULL,
  user_agent      TEXT,
  ip              TEXT,
  expires_at      INTEGER NOT NULL,
  revoked_at      INTEGER,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_customer ON sessions(customer_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
