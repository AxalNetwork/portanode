-- Append-only audit log. NEVER UPDATE or DELETE rows here.
CREATE TABLE IF NOT EXISTS events (
  id              TEXT PRIMARY KEY,
  ts              INTEGER NOT NULL,
  actor_kind      TEXT NOT NULL,           -- 'system'|'customer'|'admin'|'stripe'|'resend'
  actor_id        TEXT,
  type            TEXT NOT NULL,           -- e.g. 'quote.created','order.deposit_paid','email.sent'
  subject_kind    TEXT,                    -- 'quote'|'order'|'customer'|'lead'|'configuration'|'email'
  subject_id      TEXT,
  request_id      TEXT,
  ip              TEXT,
  payload_json    TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
CREATE INDEX IF NOT EXISTS idx_events_subject ON events(subject_kind, subject_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
