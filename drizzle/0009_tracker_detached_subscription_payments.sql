-- Preserve subscription payment history as standalone operating expenses when
-- a subscription is permanently deleted. Existing rows remain ordinary expenses.
ALTER TABLE tracker_expenses ADD COLUMN source_type TEXT CHECK (
  source_type IS NULL OR source_type = 'SUBSCRIPTION_PAYMENT'
);
ALTER TABLE tracker_expenses ADD COLUMN source_id TEXT;
ALTER TABLE tracker_expenses ADD COLUMN source_details TEXT;

CREATE UNIQUE INDEX idx_tracker_expenses_source
  ON tracker_expenses(source_type, source_id)
  WHERE source_type IS NOT NULL AND source_id IS NOT NULL;

PRAGMA optimize;
