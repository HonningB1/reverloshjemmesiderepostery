-- Review-first purchase-email intake. It is isolated from the public Reverlo
-- tables and never creates a tracker purchase until an explicit approval.
CREATE TABLE tracker_email_imports (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('RECEIVED', 'PROCESSING', 'NEEDS_REVIEW', 'READY', 'IMPORTED', 'DUPLICATE', 'REJECTED', 'FAILED')),
  source_fingerprint TEXT NOT NULL,
  message_id TEXT,
  order_key TEXT,
  original_sender TEXT NOT NULL DEFAULT '',
  forwarded_by TEXT NOT NULL DEFAULT '',
  recipient TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  email_date TEXT,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  text_body TEXT NOT NULL DEFAULT '',
  html_body TEXT NOT NULL DEFAULT '',
  attachments_json TEXT NOT NULL DEFAULT '[]',
  parsed_json TEXT NOT NULL DEFAULT '{}',
  review_json TEXT NOT NULL DEFAULT '{}',
  parser_version TEXT NOT NULL DEFAULT 'generic-v1',
  error_code TEXT,
  imported_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX idx_tracker_email_imports_fingerprint ON tracker_email_imports(source_fingerprint);
CREATE UNIQUE INDEX idx_tracker_email_imports_message_id ON tracker_email_imports(message_id) WHERE message_id IS NOT NULL;
CREATE UNIQUE INDEX idx_tracker_email_imports_order_key ON tracker_email_imports(order_key) WHERE order_key IS NOT NULL;
CREATE INDEX idx_tracker_email_imports_status_received ON tracker_email_imports(status, received_at DESC);

CREATE TABLE tracker_email_import_items (
  id TEXT PRIMARY KEY,
  email_import_id TEXT NOT NULL REFERENCES tracker_email_imports(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  parsed_json TEXT NOT NULL DEFAULT '{}',
  imported_product_id TEXT REFERENCES tracker_products(id) ON DELETE SET NULL,
  imported_transaction_id TEXT REFERENCES tracker_transactions(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(email_import_id, position)
);

CREATE INDEX idx_tracker_email_import_items_import ON tracker_email_import_items(email_import_id, position);
PRAGMA optimize;
