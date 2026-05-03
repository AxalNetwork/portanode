-- Customer portal: extended profile + privacy self-service.
-- Mirror of the Stripe customer record (billing/shipping/VAT) so the portal
-- can present + edit even if Stripe is offline; the worker pushes deltas to
-- Stripe on PATCH.
ALTER TABLE customers ADD COLUMN billing_address_json TEXT;
ALTER TABLE customers ADD COLUMN shipping_addresses_json TEXT;
ALTER TABLE customers ADD COLUMN contacts_json TEXT;
ALTER TABLE customers ADD COLUMN vat_id TEXT;
ALTER TABLE customers ADD COLUMN stripe_customer_id TEXT;

CREATE INDEX IF NOT EXISTS idx_customers_stripe ON customers(stripe_customer_id);

-- Shipment tracking surfaced in the customer portal Order Detail view. Ops
-- fills these in via the admin / fulfillment hand-off; the portal renders a
-- carrier name + tracking number and (when present) a deep-link URL.
ALTER TABLE orders ADD COLUMN tracking_carrier TEXT;
ALTER TABLE orders ADD COLUMN tracking_number TEXT;
ALTER TABLE orders ADD COLUMN tracking_url TEXT;

-- Privacy self-service ledger: GDPR / UK-DPA right-to-access (export) and
-- right-to-erasure (delete) requests are tracked here. Exports are emitted
-- inline as JSON; deletes are queued and processed by ops with a 30-day SLA
-- so we have a clear audit trail and can resolve disputes against a record.
CREATE TABLE IF NOT EXISTS privacy_requests (
  id            TEXT PRIMARY KEY,
  customer_id   TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,           -- 'export' | 'delete'
  status        TEXT NOT NULL DEFAULT 'received', -- received|processing|completed|cancelled
  notes         TEXT,
  requested_at  INTEGER NOT NULL,
  completed_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_privacy_requests_customer ON privacy_requests(customer_id);
CREATE INDEX IF NOT EXISTS idx_privacy_requests_status ON privacy_requests(status);
