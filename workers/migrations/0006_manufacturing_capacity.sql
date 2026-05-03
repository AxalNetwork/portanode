-- Manufacturing capacity per ISO week, used to compute lead times and admin gating.
CREATE TABLE IF NOT EXISTS manufacturing_capacity (
  iso_week        TEXT PRIMARY KEY,        -- 'YYYY-Www', e.g. '2026-W18'
  module_id       TEXT,                    -- NULL = aggregate
  capacity_units  INTEGER NOT NULL,
  reserved_units  INTEGER NOT NULL DEFAULT 0,
  notes           TEXT,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_capacity_module ON manufacturing_capacity(module_id);
