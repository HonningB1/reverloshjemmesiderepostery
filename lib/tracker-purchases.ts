import { calculateVatAmounts } from "./tracker-accounting.ts";
import { productId, strictTrackerText, trackerDate, trackerInteger, trackerPriceMode, trackerVatTreatment, transactionId } from "./tracker.ts";
import type { PriceMode, VatTreatment } from "../app/track/types.ts";

export type TrackerPurchaseInput = {
  name: string; quantity: number; unitPriceOre: number; shippingOre: number; supplier: string;
  supplierCountry: string; occurredAt: string; notes: string; priceMode: PriceMode; vatTreatment: VatTreatment;
  vatRateBps: number; inputVatOre: number | null; outputVatOre: number | null; deductibleVatOre: number | null;
};

function country(value: unknown) {
  if (value === null || value === undefined || value === "") return "";
  const parsed = strictTrackerText(value, 2);
  return parsed && /^[A-Za-z]{2}$/.test(parsed) ? parsed.toUpperCase() : null;
}

function optionalMoney(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  return trackerInteger(value);
}

export function parseTrackerPurchaseInput(payload: Record<string, unknown>): TrackerPurchaseInput | null {
  const name = strictTrackerText(payload.name, 160, true); const quantity = trackerInteger(payload.quantity, { min: 1, max: 1_000_000 });
  const unitPriceOre = trackerInteger(payload.unitPriceOre, { min: 0 }); const shippingOre = trackerInteger(payload.shippingOre ?? 0);
  const supplier = strictTrackerText(payload.supplier ?? "", 120); const supplierCountry = country(payload.supplierCountry);
  const occurredAt = trackerDate(payload.occurredAt); const notes = strictTrackerText(payload.notes ?? "", 2_000);
  const priceMode = trackerPriceMode(payload.priceMode ?? "VAT_EXCLUSIVE"); const vatTreatment = trackerVatTreatment(payload.vatTreatment);
  const vatRateBps = trackerInteger(payload.vatRateBps ?? 0, { max: 10_000 });
  const inputVatOre = optionalMoney(payload.inputVatOre); const outputVatOre = optionalMoney(payload.outputVatOre); const deductibleVatOre = optionalMoney(payload.deductibleVatOre);
  if (!name || quantity === null || unitPriceOre === null || shippingOre === null || supplier === null || supplierCountry === null ||
      !occurredAt || notes === null || !priceMode || !vatTreatment || vatRateBps === null ||
      (payload.inputVatOre !== null && payload.inputVatOre !== undefined && payload.inputVatOre !== "" && inputVatOre === null) ||
      (payload.outputVatOre !== null && payload.outputVatOre !== undefined && payload.outputVatOre !== "" && outputVatOre === null) ||
      (payload.deductibleVatOre !== null && payload.deductibleVatOre !== undefined && payload.deductibleVatOre !== "" && deductibleVatOre === null)) return null;
  try {
    calculateVatAmounts({ type: "PURCHASE", quantity, enteredUnitPriceOre: unitPriceOre, enteredShippingOre: shippingOre,
      priceMode, vatTreatment, vatRateBps, manualInputVatOre: inputVatOre, manualOutputVatOre: outputVatOre, manualDeductibleVatOre: deductibleVatOre });
  } catch { return null; }
  return { name, quantity, unitPriceOre, shippingOre, supplier, supplierCountry, occurredAt, notes, priceMode, vatTreatment, vatRateBps, inputVatOre, outputVatOre, deductibleVatOre };
}

export function createTrackerPurchaseStatements(db: D1Database, input: TrackerPurchaseInput) {
  const amounts = calculateVatAmounts({ type: "PURCHASE", quantity: input.quantity, enteredUnitPriceOre: input.unitPriceOre,
    enteredShippingOre: input.shippingOre, priceMode: input.priceMode, vatTreatment: input.vatTreatment, vatRateBps: input.vatRateBps,
    manualInputVatOre: input.inputVatOre, manualOutputVatOre: input.outputVatOre, manualDeductibleVatOre: input.deductibleVatOre });
  const id = productId(); const purchaseTransactionId = transactionId();
  return {
    productId: id, transactionId: purchaseTransactionId,
    statements: [
      db.prepare(`INSERT INTO tracker_products
        (id, name, quantity, remaining_quantity, purchase_price_ore, purchase_shipping_ore, supplier, purchase_date, status, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'IN_STOCK', ?)`)
        .bind(id, input.name, input.quantity, input.quantity, amounts.unitPriceOre, amounts.shippingOre, input.supplier, input.occurredAt, input.notes),
      db.prepare(`INSERT INTO tracker_transactions
        (id, product_id, type, quantity, unit_price_ore, shipping_ore, supplier, cost_basis_ore, total_costs_ore,
         notes, entered_unit_price_ore, entered_shipping_ore, price_mode, vat_treatment, vat_rate_bps, gross_amount_ore, input_vat_ore,
         output_vat_ore, deductible_vat_ore, supplier_country, occurred_at, updated_at)
        VALUES (?, ?, 'PURCHASE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`)
        .bind(purchaseTransactionId, id, input.quantity, amounts.unitPriceOre, amounts.shippingOre, input.supplier || null,
          amounts.economicPurchaseCostOre, amounts.economicPurchaseCostOre, input.notes, input.unitPriceOre, input.shippingOre,
          input.priceMode, input.vatTreatment, input.vatRateBps, amounts.grossAmountOre, amounts.inputVatOre, amounts.outputVatOre,
          amounts.deductibleVatOre, input.supplierCountry || null, input.occurredAt),
    ],
  };
}
