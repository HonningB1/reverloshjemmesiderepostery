import { calculatePrivateAmounts, calculateVatAmounts, defaultTransactionVat, priceModeForTransactionContext } from "./tracker-accounting.ts";
import {
  cleanTrackerText, strictTrackerText, subscriptionId, subscriptionPaymentId, trackerDate, trackerInteger,
  trackerPriceMode, trackerTransactionContext, trackerVatTreatment,
} from "./tracker.ts";
import { billingPeriods, type BillingPeriod, type PriceMode, type SubscriptionStatus, type TransactionContext, type VatTreatment } from "../app/track/types.ts";

const statuses = ["ACTIVE", "ARCHIVED"] as const;

export type TrackerSubscriptionInput = {
  name: string; costOre: number; category: string; billingPeriod: BillingPeriod; nextPaymentDate: string;
  autoRenew: boolean; status: SubscriptionStatus; notes: string;
};

export type TrackerSubscriptionPaymentInput = {
  subscriptionId?: string; amountOre: number; occurredAt: string; notes: string; supplierCountry: string;
  transactionContext: TransactionContext; priceMode: PriceMode | null; vatTreatment: VatTreatment | null; vatRateBps: number | null;
  inputVatOre: number | null; outputVatOre: number | null; deductibleVatOre: number | null;
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

function purchaseDefaults(context: TransactionContext) {
  return defaultTransactionVat("PURCHASE", context);
}

export function parseTrackerSubscriptionInput(payload: Record<string, unknown>): TrackerSubscriptionInput | null {
  const name = cleanTrackerText(payload.name, 160, true); const costOre = trackerInteger(payload.costOre, { min: 1 });
  const category = cleanTrackerText(payload.category, 80, true);
  const billingPeriod = typeof payload.billingPeriod === "string" && billingPeriods.includes(payload.billingPeriod as BillingPeriod)
    ? payload.billingPeriod as BillingPeriod : null;
  const nextPaymentDate = trackerDate(payload.nextPaymentDate);
  const autoRenew = payload.autoRenew === true || payload.autoRenew === 1;
  const status = typeof payload.status === "string" && statuses.includes(payload.status as SubscriptionStatus)
    ? payload.status as SubscriptionStatus : null;
  const notes = cleanTrackerText(payload.notes, 2_000) ?? "";
  return name && costOre !== null && category && billingPeriod && nextPaymentDate && status
    ? { name, costOre, category, billingPeriod, nextPaymentDate, autoRenew, status, notes } : null;
}

export function parseTrackerSubscriptionPaymentInput(payload: Record<string, unknown>): TrackerSubscriptionPaymentInput | null {
  const subscriptionId = cleanTrackerText(payload.subscriptionId, 80, true) ?? undefined;
  const amountOre = trackerInteger(payload.amountOre, { min: 1 }); const occurredAt = trackerDate(payload.occurredAt);
  const notes = cleanTrackerText(payload.notes, 2_000) ?? ""; const supplierCountry = country(payload.supplierCountry);
  const explicitContext = payload.transactionContext === undefined || payload.transactionContext === "" ? null : trackerTransactionContext(payload.transactionContext);
  const context = explicitContext ?? "PRIVATE";
  if (explicitContext === null && payload.transactionContext !== undefined && payload.transactionContext !== "") return null;
  if (context === "PRIVATE") {
    if (amountOre === null || !occurredAt || supplierCountry === null) return null;
    try { calculatePrivateAmounts({ type: "PURCHASE", quantity: 1, enteredUnitPriceOre: amountOre, enteredShippingOre: 0 }); }
    catch { return null; }
    return { subscriptionId, amountOre, occurredAt, notes, supplierCountry, transactionContext: context,
      priceMode: null, vatTreatment: null, vatRateBps: null, inputVatOre: null, outputVatOre: null, deductibleVatOre: null };
  }
  const defaults = purchaseDefaults(context);
  const proposedPriceMode = trackerPriceMode(payload.priceMode ?? defaults?.priceMode);
  const priceMode = priceModeForTransactionContext(context, proposedPriceMode);
  const vatTreatment = trackerVatTreatment(payload.vatTreatment ?? defaults?.vatTreatment);
  const vatRateBps = trackerInteger(payload.vatRateBps ?? defaults?.vatRateBps, { max: 10_000 });
  const inputVatOre = optionalMoney(payload.inputVatOre); const outputVatOre = optionalMoney(payload.outputVatOre); const deductibleVatOre = optionalMoney(payload.deductibleVatOre);
  if (amountOre === null || !occurredAt || supplierCountry === null || !priceMode || !vatTreatment || vatRateBps === null ||
      (payload.inputVatOre !== null && payload.inputVatOre !== undefined && payload.inputVatOre !== "" && inputVatOre === null) ||
      (payload.outputVatOre !== null && payload.outputVatOre !== undefined && payload.outputVatOre !== "" && outputVatOre === null) ||
      (payload.deductibleVatOre !== null && payload.deductibleVatOre !== undefined && payload.deductibleVatOre !== "" && deductibleVatOre === null)) return null;
  try {
    calculateVatAmounts({ type: "PURCHASE", quantity: 1, enteredUnitPriceOre: amountOre, enteredShippingOre: 0,
      priceMode, vatTreatment, vatRateBps, manualInputVatOre: inputVatOre, manualOutputVatOre: outputVatOre,
      manualDeductibleVatOre: deductibleVatOre });
  } catch { return null; }
  return { subscriptionId, amountOre, occurredAt, notes, supplierCountry, transactionContext: context, priceMode, vatTreatment,
    vatRateBps, inputVatOre, outputVatOre, deductibleVatOre };
}

function paymentAmounts(payment: TrackerSubscriptionPaymentInput) {
  return payment.transactionContext === "PRIVATE"
    ? calculatePrivateAmounts({ type: "PURCHASE", quantity: 1, enteredUnitPriceOre: payment.amountOre, enteredShippingOre: 0 })
    : calculateVatAmounts({ type: "PURCHASE", quantity: 1, enteredUnitPriceOre: payment.amountOre, enteredShippingOre: 0,
      priceMode: payment.priceMode!, vatTreatment: payment.vatTreatment!, vatRateBps: payment.vatRateBps!,
      manualInputVatOre: payment.inputVatOre, manualOutputVatOre: payment.outputVatOre, manualDeductibleVatOre: payment.deductibleVatOre });
}

export function createTrackerSubscriptionStatements(db: D1Database, subscription: TrackerSubscriptionInput, payment?: TrackerSubscriptionPaymentInput) {
  const id = subscriptionId(); const statements: D1PreparedStatement[] = [db.prepare(`INSERT INTO tracker_subscriptions
    (id, name, cost_ore, category, billing_period, next_payment_date, auto_renew, status, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, subscription.name, subscription.costOre, subscription.category, subscription.billingPeriod, subscription.nextPaymentDate,
      subscription.autoRenew ? 1 : 0, subscription.status, subscription.notes)];
  if (!payment) return { subscriptionId: id, paymentId: null, statements };
  const amounts = paymentAmounts(payment);
  const paymentId = subscriptionPaymentId(); statements.push(db.prepare(`INSERT INTO tracker_subscription_payments
    (id, subscription_id, amount_ore, entered_amount_ore, price_mode, vat_treatment, vat_rate_bps, gross_amount_ore,
     input_vat_ore, output_vat_ore, deductible_vat_ore, supplier_country, transaction_context, occurred_at, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(paymentId, id, amounts.economicPurchaseCostOre, payment.amountOre, payment.priceMode, payment.vatTreatment,
      payment.vatRateBps, amounts.grossAmountOre,
      payment.transactionContext === "PRIVATE" ? null : amounts.inputVatOre,
      payment.transactionContext === "PRIVATE" ? null : amounts.outputVatOre,
      payment.transactionContext === "PRIVATE" ? null : amounts.deductibleVatOre,
      payment.supplierCountry || null, payment.transactionContext, payment.occurredAt, payment.notes));
  return { subscriptionId: id, paymentId, statements };
}

export function createTrackerSubscriptionPaymentStatement(db: D1Database, payment: TrackerSubscriptionPaymentInput) {
  if (!payment.subscriptionId) throw new Error("Subscription payment requires a subscription.");
  const amounts = paymentAmounts(payment);
  const id = subscriptionPaymentId();
  return { paymentId: id, amounts, statement: db.prepare(`INSERT INTO tracker_subscription_payments
    (id, subscription_id, amount_ore, entered_amount_ore, price_mode, vat_treatment, vat_rate_bps, gross_amount_ore,
     input_vat_ore, output_vat_ore, deductible_vat_ore, supplier_country, transaction_context, occurred_at, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, payment.subscriptionId, amounts.economicPurchaseCostOre, payment.amountOre, payment.priceMode, payment.vatTreatment,
      payment.vatRateBps, amounts.grossAmountOre,
      payment.transactionContext === "PRIVATE" ? null : amounts.inputVatOre,
      payment.transactionContext === "PRIVATE" ? null : amounts.outputVatOre,
      payment.transactionContext === "PRIVATE" ? null : amounts.deductibleVatOre,
      payment.supplierCountry || null, payment.transactionContext, payment.occurredAt, payment.notes) };
}
