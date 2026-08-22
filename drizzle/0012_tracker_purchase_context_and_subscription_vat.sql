-- Additive context and VAT metadata for new tracker purchases only.
-- Historical rows remain NULL/unchanged so no historical treatment is inferred.
ALTER TABLE tracker_transactions ADD COLUMN transaction_context TEXT CHECK (
  transaction_context IS NULL OR transaction_context IN ('PRIVATE', 'B2B', 'SPECIAL')
);

ALTER TABLE tracker_subscription_payments ADD COLUMN entered_amount_ore INTEGER CHECK (entered_amount_ore IS NULL OR entered_amount_ore >= 0);
ALTER TABLE tracker_subscription_payments ADD COLUMN price_mode TEXT CHECK (price_mode IS NULL OR price_mode IN ('VAT_EXCLUSIVE', 'VAT_INCLUSIVE'));
ALTER TABLE tracker_subscription_payments ADD COLUMN vat_treatment TEXT CHECK (
  vat_treatment IS NULL OR vat_treatment IN (
    'DANISH_PURCHASE_DEDUCTIBLE', 'EU_PURCHASE_REVERSE_CHARGE',
    'PRIVATE_PURCHASE_NO_DEDUCTION', 'NO_VAT_OUTSIDE_SCOPE', 'CUSTOM_MANUAL'
  )
);
ALTER TABLE tracker_subscription_payments ADD COLUMN vat_rate_bps INTEGER CHECK (vat_rate_bps IS NULL OR (vat_rate_bps >= 0 AND vat_rate_bps <= 10000));
ALTER TABLE tracker_subscription_payments ADD COLUMN gross_amount_ore INTEGER CHECK (gross_amount_ore IS NULL OR gross_amount_ore >= 0);
ALTER TABLE tracker_subscription_payments ADD COLUMN input_vat_ore INTEGER CHECK (input_vat_ore IS NULL OR input_vat_ore >= 0);
ALTER TABLE tracker_subscription_payments ADD COLUMN output_vat_ore INTEGER CHECK (output_vat_ore IS NULL OR output_vat_ore >= 0);
ALTER TABLE tracker_subscription_payments ADD COLUMN deductible_vat_ore INTEGER CHECK (deductible_vat_ore IS NULL OR deductible_vat_ore >= 0);
ALTER TABLE tracker_subscription_payments ADD COLUMN supplier_country TEXT;
ALTER TABLE tracker_subscription_payments ADD COLUMN transaction_context TEXT CHECK (
  transaction_context IS NULL OR transaction_context IN ('PRIVATE', 'B2B', 'SPECIAL')
);

CREATE INDEX idx_tracker_transactions_context_date ON tracker_transactions(transaction_context, occurred_at);
CREATE INDEX idx_tracker_subscription_payments_vat_date ON tracker_subscription_payments(vat_treatment, occurred_at);
PRAGMA optimize;
