-- Leads: contact, leasing, spec-download form submissions
CREATE TABLE IF NOT EXISTS leads (
  id              TEXT PRIMARY KEY,
  kind            TEXT NOT NULL,           -- 'contact'|'leasing'|'spec_download'|'newsletter'
  email           TEXT NOT NULL,
  name            TEXT,
  company         TEXT,
  phone           TEXT,
  region          TEXT,
  message         TEXT,
  asset_id        TEXT,                    -- spec/whitepaper id when relevant
  utm_json        TEXT,
  ip              TEXT,
  user_agent      TEXT,
  status          TEXT NOT NULL DEFAULT 'new', -- 'new'|'contacted'|'qualified'|'closed'|'spam'
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_leads_kind ON leads(kind);
CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email);
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);

-- Email subscriptions (newsletter / drip lists)
CREATE TABLE IF NOT EXISTS email_subscriptions (
  email           TEXT PRIMARY KEY,
  status          TEXT NOT NULL DEFAULT 'active', -- 'active'|'unsubscribed'|'bounced'|'complained'
  list            TEXT NOT NULL DEFAULT 'newsletter',
  source          TEXT,
  subscribed_at   INTEGER NOT NULL,
  unsubscribed_at INTEGER,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_email_subs_status ON email_subscriptions(status);
