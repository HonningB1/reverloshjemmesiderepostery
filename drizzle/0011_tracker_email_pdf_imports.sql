-- Add provenance and attachment-hash idempotency for the review-first PDF intake.
ALTER TABLE tracker_email_imports ADD COLUMN original_subject TEXT NOT NULL DEFAULT '';
ALTER TABLE tracker_email_imports ADD COLUMN attachment_fingerprint TEXT;

CREATE UNIQUE INDEX idx_tracker_email_imports_attachment_fingerprint
  ON tracker_email_imports(attachment_fingerprint)
  WHERE attachment_fingerprint IS NOT NULL;

PRAGMA optimize;
