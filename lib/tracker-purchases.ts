import { calculatePrivateAmounts, calculateVatAmounts, defaultTransactionVat, priceModeForTransactionContext, transactionContextForVatTreatment } from "./tracker-accounting.ts";
import { productId, strictTrackerText, trackerDate, trackerInteger, trackerPriceMode, trackerTransactionContext, trackerVatTreatment, transactionId } from "./tracker.ts";
import type { PriceMode, TransactionContext, VatTreatment } from "../app/track/types.ts";

export type TrackerPurchaseInput = {
  name: string; quantity: number; unitPriceOre: number; shippingOre: number; supplier: string;
  supplierCountry: string; occurredAt: string; notes: string; priceMode: PriceMode | null; vatTreatment: VatTreatment | null;
  vatRateBps: number | null; inputVatOre: number | null; outputVatOre: number | null; deductibleVatOre: number | null; transactionContext: TransactionContext;
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
  const contextSupplied = payload.transactionContext !== undefined && payload.transactionContext !== "";
  const explicitContext = contextSupplied ? trackerTransactionContext(payload.transactionContext) : null;
  const treatmentSupplied = payload.vatTreatment !== undefined && payload.vatTreatment !== "";
  const requestedTreatment = treatmentSupplied ? trackerVatTreatment(payload.vatTreatment) : null;
  if ((contextSupplied && !explicitContext) || (treatmentSupplied && !requestedTreatment)) return null;
  const transactionContext = explicitContext ?? transactionContextForVatTreatment(requestedTreatment);
  if (transactionContext === "PRIVATE") {
    if (!name || quantity === null || unitPriceOre === null || shippingOre === null || supplier === null || supplierCountry === null || !occurredAt || notes === null) return null;
    try { calculatePrivateAmounts({ type: "PURCHASE", quantity, enteredUnitPriceOre: unitPriceOre, enteredShippingOre: shippingOre }); }
    catch { return null; }
    return { name, quantity, unitPriceOre, shippingOre, supplier, supplierCountry, occurredAt, notes,
      priceMode: null, vatTreatment: null, vatRateBps: null, inputVatOre: null, outputVatOre: null, deductibleVatOre: null, transactionContext };
  }
  const defaults = defaultTransactionVat("PURCHASE", transactionContext);
  const proposedPriceMode = trackerPriceMode(payload.priceMode ?? defaults?.priceMode);
  const priceMode = priceModeForTransactionContext(transactionContext, proposedPriceMode);
  const vatTreatment = requestedTreatment ?? trackerVatTreatment(defaults?.vatTreatment);
  const vatRateBps = trackerInteger(payload.vatRateBps ?? defaults?.vatRateBps, { max: 10_000 });
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
  return { name, quantity, unitPriceOre, shippingOre, supplier, supplierCountry, occurredAt, notes, priceMode, vatTreatment, vatRateBps, inputVatOre, outputVatOre, deductibleVatOre, transactionContext };
}

function purchaseAmounts(input: TrackerPurchaseInput) {
  return input.transactionContext === "PRIVATE"
    ? calculatePrivateAmounts({ type: "PURCHASE", quantity: input.quantity, enteredUnitPriceOre: input.unitPriceOre, enteredShippingOre: input.shippingOre })
    : calculateVatAmounts({ type: "PURCHASE", quantity: input.quantity, enteredUnitPriceOre: input.unitPriceOre,
      enteredShippingOre: input.shippingOre, priceMode: input.priceMode!, vatTreatment: input.vatTreatment!, vatRateBps: input.vatRateBps!,
      manualInputVatOre: input.inputVatOre, manualOutputVatOre: input.outputVatOre, manualDeductibleVatOre: input.deductibleVatOre });
}

export function createTrackerPurchaseStatements(db: D1Database, input: TrackerPurchaseInput) {
  const amounts = purchaseAmounts(input);
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
         output_vat_ore, deductible_vat_ore, supplier_country, transaction_context, occurred_at, updated_at)
        VALUES (?, ?, 'PURCHASE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`)
        .bind(purchaseTransactionId, id, input.quantity, amounts.unitPriceOre, amounts.shippingOre, input.supplier || null,
          amounts.economicPurchaseCostOre, amounts.economicPurchaseCostOre, input.notes, input.unitPriceOre, input.shippingOre,
          input.priceMode, input.vatTreatment, input.vatRateBps, amounts.grossAmountOre,
          input.transactionContext === "PRIVATE" ? null : amounts.inputVatOre,
          input.transactionContext === "PRIVATE" ? null : amounts.outputVatOre,
          input.transactionContext === "PRIVATE" ? null : amounts.deductibleVatOre,
          input.supplierCountry || null, input.transactionContext, input.occurredAt),
    ],
  };
}
