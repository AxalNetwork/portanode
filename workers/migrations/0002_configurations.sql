-- Configurations: persisted module/stack configs from the configurator
CREATE TABLE IF NOT EXISTS configurations (
  id              TEXT PRIMARY KEY,        -- short id (nanoid 10)
  customer_id     TEXT REFERENCES customers(id) ON DELETE SET NULL,
  source          TEXT NOT NULL,           -- 'configurator' | 'stack' | 'admin'
  region          TEXT NOT NULL,
  payload_json    TEXT NOT NULL,           -- canonical config blob
  totals_json     TEXT NOT NULL,           -- {priceUsd, weightKg, powerKw, leadTimeWeeks}
  catalog_version TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_configurations_customer ON configurations(customer_id);
CREATE INDEX IF NOT EXISTS idx_configurations_created ON configurations(created_at);
