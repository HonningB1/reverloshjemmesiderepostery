-- Reverlo Tracker V2: transaction VAT metadata and VAT settlements.
-- Existing transactions deliberately remain VAT-unknown (NULL) so historical
-- VAT is never inferred from incomplete data.

ALTER TABLE tracker_transactions ADD COLUMN notes TEXT NOT NULL DEFAULT '';
ALTER TABLE tracker_transactions ADD COLUMN entered_unit_price_ore INTEGER CHECK (entered_unit_price_ore IS NULL OR entered_unit_price_ore >= 0);
ALTER TABLE tracker_transactions ADD COLUMN entered_shipping_ore INTEGER CHECK (entered_shipping_ore IS NULL OR entered_shipping_ore >= 0);
ALTER TABLE tracker_transactions ADD COLUMN entered_total_price_ore INTEGER CHECK (entered_total_price_ore IS NULL OR entered_total_price_ore >= 0);
ALTER TABLE tracker_transactions ADD COLUMN price_mode TEXT CHECK (price_mode IS NULL OR price_mode IN ('VAT_EXCLUSIVE', 'VAT_INCLUSIVE'));
ALTER TABLE tracker_transactions ADD COLUMN vat_treatment TEXT CHECK (
  vat_treatment IS NULL OR vat_treatment IN (
    'DANISH_PURCHASE_DEDUCTIBLE',
    'DANISH_SALE_VAT',
    'EU_B2B_SALE_REVERSE_CHARGE',
    'EU_PURCHASE_REVERSE_CHARGE',
    'PRIVATE_PURCHASE_NO_DEDUCTION',
    'NO_VAT_OUTSIDE_SCOPE',
    'CUSTOM_MANUAL'
  )
);
ALTER TABLE tracker_transactions ADD COLUMN vat_rate_bps INTEGER CHECK (vat_rate_bps IS NULL OR (vat_rate_bps >= 0 AND vat_rate_bps <= 10000));
ALTER TABLE tracker_transactions ADD COLUMN gross_amount_ore INTEGER CHECK (gross_amount_ore IS NULL OR gross_amount_ore >= 0);
ALTER TABLE tracker_transactions ADD COLUMN input_vat_ore INTEGER CHECK (input_vat_ore IS NULL OR input_vat_ore >= 0);
ALTER TABLE tracker_transactions ADD COLUMN output_vat_ore INTEGER CHECK (output_vat_ore IS NULL OR output_vat_ore >= 0);
ALTER TABLE tracker_transactions ADD COLUMN deductible_vat_ore INTEGER CHECK (deductible_vat_ore IS NULL OR deductible_vat_ore >= 0);
ALTER TABLE tracker_transactions ADD COLUMN supplier_country TEXT;
ALTER TABLE tracker_transactions ADD COLUMN customer_country TEXT;
ALTER TABLE tracker_transactions ADD COLUMN is_b2b INTEGER CHECK (is_b2b IS NULL OR is_b2b IN (0, 1));
ALTER TABLE tracker_transactions ADD COLUMN vat_id_reference TEXT;
ALTER TABLE tracker_transactions ADD COLUMN updated_at TEXT;

CREATE INDEX idx_tracker_transactions_vat_date ON tracker_transactions(vat_treatment, occurred_at);

CREATE TABLE tracker_vat_settlements (
  id TEXT PRIMARY KEY,
  direction TEXT NOT NULL CHECK (direction IN ('PAID', 'RECEIVED')),
  amount_ore INTEGER NOT NULL CHECK (amount_ore > 0),
  occurred_at TEXT NOT NULL,
  reference TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_tracker_vat_settlements_date ON tracker_vat_settlements(occurred_at);
