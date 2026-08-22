import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  calculatePrivateAmounts, calculateVatAmounts, defaultTransactionVat, priceModeForTransactionContext, recalculateProductSales, vatPosition,
} from "../lib/tracker-accounting.ts";
import { effectiveTransactionContext, effectiveTransactionContextSql } from "../lib/tracker-context.ts";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");
const renderContextSql = (sql) => sql.replace(/\$\{effectiveTransactionContextSql\("([^"]+)"(?:, "([^"]+)")?\)\}/g,
  (_match, contextColumn, isB2bColumn) => effectiveTransactionContextSql(contextColumn, isB2bColumn));

test("Danish deductible purchase stores gross cash, input VAT and net economic cost exactly", () => {
  assert.deepEqual(calculateVatAmounts({
    type: "PURCHASE", quantity: 3, enteredUnitPriceOre: 156_125, enteredShippingOre: 8_625,
    priceMode: "VAT_INCLUSIVE", vatTreatment: "DANISH_PURCHASE_DEDUCTIBLE", vatRateBps: 2_500,
  }), {
    unitPriceOre: 124_900, shippingOre: 6_900, revenueOre: 0, economicPurchaseCostOre: 381_600,
    grossAmountOre: 477_000, inputVatOre: 95_400, outputVatOre: 0, deductibleVatOre: 95_400,
  });
});

test("Danish VAT-inclusive sale separates output VAT from revenue and profit inputs", () => {
  const result = calculateVatAmounts({
    type: "SALE", quantity: 1, enteredUnitPriceOre: 12_500, enteredShippingOre: 0,
    priceMode: "VAT_INCLUSIVE", vatTreatment: "DANISH_SALE_VAT", vatRateBps: 2_500,
  });
  assert.equal(result.grossAmountOre, 12_500);
  assert.equal(result.revenueOre, 10_000);
  assert.equal(result.outputVatOre, 2_500);
});

test("EU B2B sales remain zero-rated and require no output VAT calculation", () => {
  const result = calculateVatAmounts({
    type: "SALE", quantity: 3, enteredUnitPriceOre: 193_638, enteredShippingOre: 17_000,
    priceMode: "VAT_EXCLUSIVE", vatTreatment: "EU_B2B_SALE_REVERSE_CHARGE", vatRateBps: 0,
  });
  assert.equal(result.revenueOre, 580_914);
  assert.equal(result.outputVatOre, 0);
  assert.equal(result.grossAmountOre, 580_914);
  const exactLegacyTotal = calculateVatAmounts({
    type: "SALE", quantity: 3, enteredUnitPriceOre: 193_638, enteredTotalPriceOre: 580_915, enteredShippingOre: 17_000,
    priceMode: "VAT_EXCLUSIVE", vatTreatment: "EU_B2B_SALE_REVERSE_CHARGE", vatRateBps: 0,
  });
  assert.equal(exactLegacyTotal.revenueOre, 580_915, "an exact total must preserve non-divisible legacy revenue");
});

test("EU purchase reverse charge posts equal input/output VAT without changing economic cost", () => {
  const result = calculateVatAmounts({
    type: "PURCHASE", quantity: 1, enteredUnitPriceOre: 100_000, enteredShippingOre: 0,
    priceMode: "VAT_EXCLUSIVE", vatTreatment: "EU_PURCHASE_REVERSE_CHARGE", vatRateBps: 2_500,
  });
  assert.equal(result.grossAmountOre, 100_000);
  assert.equal(result.inputVatOre, 25_000);
  assert.equal(result.outputVatOre, 25_000);
  assert.equal(result.deductibleVatOre, 25_000);
  assert.equal(result.economicPurchaseCostOre, 100_000);
});

test("PRIVATE purchases are final cash costs with no VAT contribution", () => {
  const privatePurchase = calculateVatAmounts({
    type: "PURCHASE", quantity: 1, enteredUnitPriceOre: 125_000, enteredShippingOre: 0,
    priceMode: "VAT_INCLUSIVE", vatTreatment: "PRIVATE_PURCHASE_NO_DEDUCTION", vatRateBps: 2_500,
  });
  assert.equal(privatePurchase.inputVatOre, 0);
  assert.equal(privatePurchase.deductibleVatOre, 0);
  assert.equal(privatePurchase.economicPurchaseCostOre, 125_000);
  const outside = calculateVatAmounts({
    type: "PURCHASE", quantity: 1, enteredUnitPriceOre: 125_000, enteredShippingOre: 0,
    priceMode: "VAT_EXCLUSIVE", vatTreatment: "NO_VAT_OUTSIDE_SCOPE", vatRateBps: 0,
  });
  assert.equal(outside.inputVatOre, 0);
  assert.equal(outside.economicPurchaseCostOre, 125_000);
});

test("custom VAT rejects deductions above input VAT", () => {
  assert.throws(() => calculateVatAmounts({
    type: "PURCHASE", quantity: 1, enteredUnitPriceOre: 100_000, enteredShippingOre: 0,
    priceMode: "VAT_EXCLUSIVE", vatTreatment: "CUSTOM_MANUAL", vatRateBps: 0,
    manualInputVatOre: 10_000, manualOutputVatOre: 0, manualDeductibleVatOre: 10_001,
  }), /cannot exceed input VAT/);
});

test("VAT settlements close positions without entering profit calculations", () => {
  assert.deepEqual(vatPosition({ deductibleInputVatOre: 95_400, outputVatOre: 0, paidSettlementsOre: 0, receivedSettlementsOre: 95_400 }), {
    openPositionOre: 0, receivableOre: 0, payableOre: 0,
  });
  assert.deepEqual(vatPosition({ deductibleInputVatOre: 0, outputVatOre: 25_000, paidSettlementsOre: 25_000, receivedSettlementsOre: 0 }), {
    openPositionOre: 0, receivableOre: 0, payableOre: 0,
  });
});

test("sale edits and deletes recalculate shipping allocation, inventory and profit", () => {
  const product = { quantity: 3, purchasePriceOre: 100_000, purchaseShippingOre: 100 };
  const first = { id: "a", quantity: 1, revenueOre: 150_000, feeOre: 0, promotedFeeOre: 0, shippingOre: 0, otherCostsOre: 0, occurredAt: "2026-01-02" };
  const second = { ...first, id: "b", quantity: 2, revenueOre: 300_000, occurredAt: "2026-01-01" };
  const full = recalculateProductSales(product, [first, second]);
  assert.equal(full.remainingQuantity, 0);
  assert.equal(full.sales.reduce((sum, sale) => sum + sale.costBasisOre, 0), 300_100);
  const afterDelete = recalculateProductSales(product, [first]);
  assert.equal(afterDelete.remainingQuantity, 2);
  assert.equal(afterDelete.sales[0].netProfitOre, 49_967);
  assert.throws(() => recalculateProductSales(product, [{ ...second, quantity: 4 }]), /sell more units/);
});

test("V2 migration is additive and leaves historical VAT unknown", async () => {
  const migration = await source("drizzle/0008_tracker_vat_and_transaction_editing.sql");
  assert.match(migration, /vat_treatment IS NULL/);
  assert.match(migration, /CREATE TABLE tracker_vat_settlements/);
  assert.match(migration, /entered_unit_price_ore/);
  assert.match(migration, /entered_total_price_ore/);
  assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM|UPDATE tracker_transactions/i);
});

test("transaction API exposes edit/delete, transaction notes and atomic ledger recalculation", async () => {
  const route = await source("app/api/track/transactions/route.ts");
  assert.match(route, /export async function PATCH/);
  assert.match(route, /export async function DELETE/);
  assert.match(route, /recalculateProductSales/);
  assert.match(route, /notes/);
  assert.match(route, /EU_B2B_DETAILS_REQUIRED/);
  assert.match(route, /PURCHASE_HAS_SALES/);
  assert.match(route, /db\.batch/);
});

test("legacy purchase reclassification persists explicit B2B, SPECIAL and PRIVATE accounting states", async () => {
  const db = new DatabaseSync(":memory:");
  for (const migration of [
    "drizzle/0005_private_reselling_tracker.sql", "drizzle/0007_tracker_expenses_subscriptions.sql", "drizzle/0008_tracker_vat_and_transaction_editing.sql",
    "drizzle/0012_tracker_purchase_context_and_subscription_vat.sql",
  ]) db.exec(await source(migration));
  db.exec(`INSERT INTO tracker_products (id, name, quantity, remaining_quantity, purchase_price_ore, purchase_date, status)
    VALUES ('p', 'Legacy item', 1, 1, 125000, '2026-01-01', 'IN_STOCK');
    INSERT INTO tracker_transactions (id, product_id, type, quantity, unit_price_ore, shipping_ore, cost_basis_ore, total_costs_ore,
      transaction_context, is_b2b, price_mode, vat_treatment, vat_rate_bps, gross_amount_ore, input_vat_ore, deductible_vat_ore, occurred_at)
    VALUES ('legacy', 'p', 'PURCHASE', 1, 125000, 0, 125000, 125000, NULL, NULL, 'VAT_INCLUSIVE', 'CUSTOM_MANUAL', 2500, 125000, 25000, 25000, '2026-01-01');`);
  const apply = (context, priceMode, treatment, rate, amounts) => db.prepare(`UPDATE tracker_transactions SET
    unit_price_ore = ?, shipping_ore = ?, cost_basis_ore = ?, total_costs_ore = ?, price_mode = ?, vat_treatment = ?, vat_rate_bps = ?,
    gross_amount_ore = ?, input_vat_ore = ?, output_vat_ore = ?, deductible_vat_ore = ?, transaction_context = ?, is_b2b = ? WHERE id = 'legacy'`)
    .run(amounts.unitPriceOre, amounts.shippingOre, amounts.economicPurchaseCostOre, amounts.economicPurchaseCostOre,
      priceMode, treatment, rate, amounts.grossAmountOre,
      context === "PRIVATE" ? null : amounts.inputVatOre, context === "PRIVATE" ? null : amounts.outputVatOre,
      context === "PRIVATE" ? null : amounts.deductibleVatOre, context, context === "B2B" ? 1 : 0);
  const b2b = calculateVatAmounts({ type: "PURCHASE", quantity: 1, enteredUnitPriceOre: 125_000, enteredShippingOre: 0,
    priceMode: "VAT_INCLUSIVE", vatTreatment: "DANISH_PURCHASE_DEDUCTIBLE", vatRateBps: 2_500 });
  apply("B2B", "VAT_INCLUSIVE", "DANISH_PURCHASE_DEDUCTIBLE", 2_500, b2b);
  assert.deepEqual({ ...db.prepare("SELECT transaction_context AS context, is_b2b AS isB2b, input_vat_ore AS inputVatOre, deductible_vat_ore AS deductibleVatOre, cost_basis_ore AS costBasisOre FROM tracker_transactions").get() },
    { context: "B2B", isB2b: 1, inputVatOre: 25_000, deductibleVatOre: 25_000, costBasisOre: 100_000 });
  const special = calculateVatAmounts({ type: "PURCHASE", quantity: 1, enteredUnitPriceOre: 100_000, enteredShippingOre: 0,
    priceMode: "VAT_EXCLUSIVE", vatTreatment: "EU_PURCHASE_REVERSE_CHARGE", vatRateBps: 2_500 });
  apply("SPECIAL", "VAT_EXCLUSIVE", "EU_PURCHASE_REVERSE_CHARGE", 2_500, special);
  assert.deepEqual({ ...db.prepare("SELECT transaction_context AS context, is_b2b AS isB2b, input_vat_ore AS inputVatOre, output_vat_ore AS outputVatOre, deductible_vat_ore AS deductibleVatOre FROM tracker_transactions").get() },
    { context: "SPECIAL", isB2b: 0, inputVatOre: 25_000, outputVatOre: 25_000, deductibleVatOre: 25_000 });
  const privateAmounts = calculatePrivateAmounts({ type: "PURCHASE", quantity: 1, enteredUnitPriceOre: 97_170, enteredShippingOre: 0 });
  apply("PRIVATE", null, null, null, privateAmounts);
  assert.deepEqual({ ...db.prepare("SELECT transaction_context AS context, is_b2b AS isB2b, price_mode AS priceMode, vat_treatment AS vatTreatment, vat_rate_bps AS vatRateBps, input_vat_ore AS inputVatOre, output_vat_ore AS outputVatOre, deductible_vat_ore AS deductibleVatOre, cost_basis_ore AS costBasisOre FROM tracker_transactions").get() },
    { context: "PRIVATE", isB2b: 0, priceMode: null, vatTreatment: null, vatRateBps: null, inputVatOre: null, outputVatOre: null, deductibleVatOre: null, costBasisOre: 97_170 });
  const route = await source("app/api/track/transactions/route.ts");
  assert.match(route, /is_b2b = \?/);
  assert.match(route, /accounting\.transactionContext === "B2B" \? 1 : 0/);
  db.close();
});

test("language choice and Starlink repair are explicit, persisted and dry-run safe", async () => {
  const [i18n, repair] = await Promise.all([source("app/track/i18n.tsx"), source("scripts/repair-starlink-vat.mjs")]);
  assert.match(i18n, /reverlo-tracker-locale/);
  assert.match(i18n, /"da"/);
  assert.match(repair, /DRY RUN — no D1 writes/);
  assert.match(repair, /Supplier country remains unset/);
  assert.match(repair, /2 = \(/);
  assert.match(repair, /--confirm/);
});

test("normal manual transactions default to PRIVATE cash semantics while explicit VAT treatment is SPECIAL", async () => {
  const purchases = await source("lib/tracker-purchases.ts");
  const [route, ui] = await Promise.all([source("app/api/track/transactions/route.ts"), source("app/track/TrackerTransactions.tsx")]);
  assert.match(purchases, /priceModeForTransactionContext\(transactionContext, proposedPriceMode\)/);
  assert.match(route, /priceModeForTransactionContext\(transactionContext, proposedPriceMode\)/);
  assert.match(ui, /priceModeForTransactionContext\(initialTransactionContext, transaction\?\.priceMode\)/);
  const privateCost = calculatePrivateAmounts({ type: "PURCHASE", quantity: 1, enteredUnitPriceOre: 125_000, enteredShippingOre: 0 });
  assert.equal(privateCost.grossAmountOre, 125_000); assert.equal(privateCost.economicPurchaseCostOre, 125_000); assert.equal(privateCost.deductibleVatOre, 0);
  const b2cSale = calculatePrivateAmounts({ type: "SALE", quantity: 1, enteredUnitPriceOre: 100_000, enteredTotalPriceOre: 100_000, enteredShippingOre: 0 });
  assert.equal(b2cSale.grossAmountOre, 100_000); assert.equal(b2cSale.revenueOre, 100_000); assert.equal(b2cSale.outputVatOre, 0);
  assert.equal(defaultTransactionVat("SALE"), null);
  assert.equal(defaultTransactionVat("SALE", "B2B"), null);
  const b2b = calculateVatAmounts({ type: "SALE", quantity: 1, enteredUnitPriceOre: 100_000, enteredShippingOre: 0, priceMode: "VAT_EXCLUSIVE", vatTreatment: "EU_B2B_SALE_REVERSE_CHARGE", vatRateBps: 0 });
  assert.equal(b2b.grossAmountOre, 100_000); assert.equal(b2b.outputVatOre, 0);
});

test("PRIVATE/B2C amounts remain gross while explicit VAT calculations stay separate", () => {
  assert.equal(priceModeForTransactionContext("PRIVATE", "VAT_EXCLUSIVE"), "VAT_INCLUSIVE");
  assert.equal(priceModeForTransactionContext("B2B", "VAT_EXCLUSIVE"), "VAT_EXCLUSIVE");
  const sale = calculatePrivateAmounts({ type: "SALE", quantity: 1, enteredUnitPriceOre: 96_886, enteredTotalPriceOre: 96_886, enteredShippingOre: 0 });
  assert.deepEqual({ gross: sale.grossAmountOre, revenue: sale.revenueOre, outputVat: sale.outputVatOre }, { gross: 96_886, revenue: 96_886, outputVat: 0 });
  const privatePurchase = calculatePrivateAmounts({ type: "PURCHASE", quantity: 1, enteredUnitPriceOre: 100_000, enteredShippingOre: 0 });
  assert.deepEqual({ gross: privatePurchase.grossAmountOre, cost: privatePurchase.economicPurchaseCostOre, deductibleVat: privatePurchase.deductibleVatOre }, { gross: 100_000, cost: 100_000, deductibleVat: 0 });
  const deductiblePurchase = calculateVatAmounts({ type: "PURCHASE", quantity: 1, enteredUnitPriceOre: 100_000, enteredShippingOre: 0,
    priceMode: "VAT_INCLUSIVE", vatTreatment: "DANISH_PURCHASE_DEDUCTIBLE", vatRateBps: 2_500 });
  assert.deepEqual({ gross: deductiblePurchase.grossAmountOre, cost: deductiblePurchase.economicPurchaseCostOre, inputVat: deductiblePurchase.inputVatOre }, { gross: 100_000, cost: 80_000, inputVat: 20_000 });
});

test("legacy NULL context is PRIVATE unless its explicit legacy B2B checkbox is set", () => {
  assert.equal(effectiveTransactionContext(null), "PRIVATE");
  assert.equal(effectiveTransactionContext(null, 0), "PRIVATE");
  assert.equal(effectiveTransactionContext(null, 1), "B2B");
  assert.equal(effectiveTransactionContext("PRIVATE", 1), "PRIVATE");
  assert.equal(effectiveTransactionContext("SPECIAL", 1), "SPECIAL");
});

test("VAT totals exclude effective PRIVATE rows, including NULL-context legacy VAT fields", async () => {
  const db = new DatabaseSync(":memory:");
  for (const migration of [
    "drizzle/0005_private_reselling_tracker.sql", "drizzle/0007_tracker_expenses_subscriptions.sql",
    "drizzle/0008_tracker_vat_and_transaction_editing.sql", "drizzle/0009_tracker_detached_subscription_payments.sql",
    "drizzle/0012_tracker_purchase_context_and_subscription_vat.sql",
  ]) db.exec(await source(migration));
  db.exec(`INSERT INTO tracker_products (id, name, quantity, remaining_quantity, purchase_price_ore, purchase_date, status) VALUES ('p', 'Item', 1, 1, 1, '2026-01-01', 'IN_STOCK');
    INSERT INTO tracker_transactions (id, product_id, type, quantity, unit_price_ore, shipping_ore, cost_basis_ore, total_costs_ore, transaction_context, is_b2b, vat_treatment, input_vat_ore, output_vat_ore, deductible_vat_ore, occurred_at) VALUES
      ('private-purchase', 'p', 'PURCHASE', 1, 1, 0, 1, 1, 'PRIVATE', NULL, 'CUSTOM_MANUAL', 500, 0, 500, '2026-01-01'),
      ('private-sale', 'p', 'SALE', 1, 1, 0, 1, 1, 'PRIVATE', NULL, 'DANISH_SALE_VAT', 0, 700, 0, '2026-01-02'),
      ('legacy-private-purchase', 'p', 'PURCHASE', 1, 1, 0, 1, 1, NULL, 0, 'CUSTOM_MANUAL', 600, 0, 600, '2026-01-02'),
      ('legacy-private-sale', 'p', 'SALE', 1, 1, 0, 1, 1, NULL, 0, 'DANISH_SALE_VAT', 0, 800, 0, '2026-01-02'),
      ('legacy-b2b-purchase', 'p', 'PURCHASE', 1, 1, 0, 1, 1, NULL, 1, 'CUSTOM_MANUAL', 70, 0, 70, '2026-01-02'),
      ('b2b-purchase', 'p', 'PURCHASE', 1, 1, 0, 1, 1, 'B2B', NULL, 'DANISH_PURCHASE_DEDUCTIBLE', 200, 0, 180, '2026-01-03'),
      ('b2b-danish-sale', 'p', 'SALE', 1, 1, 0, 1, 1, 'B2B', NULL, 'DANISH_SALE_VAT', 0, 300, 0, '2026-01-04'),
      ('b2b-eu-zero-sale', 'p', 'SALE', 1, 1, 0, 1, 1, 'B2B', NULL, 'EU_B2B_SALE_REVERSE_CHARGE', 0, 0, 0, '2026-01-04'),
      ('special-purchase', 'p', 'PURCHASE', 1, 1, 0, 1, 1, 'SPECIAL', NULL, 'CUSTOM_MANUAL', 40, 0, 40, '2026-01-05'),
      ('special-sale', 'p', 'SALE', 1, 1, 0, 1, 1, 'SPECIAL', NULL, 'CUSTOM_MANUAL', 0, 90, 0, '2026-01-05');
    INSERT INTO tracker_subscriptions (id, name, cost_ore, category, billing_period, next_payment_date, auto_renew, status) VALUES ('s', 'Service', 1, 'Software', 'MONTHLY', '2026-01-01', 0, 'ACTIVE');
    INSERT INTO tracker_subscription_payments (id, subscription_id, amount_ore, transaction_context, input_vat_ore, deductible_vat_ore, occurred_at, notes) VALUES
      ('private-payment', 's', 1, 'PRIVATE', 50, 50, '2026-01-01', ''),
      ('special-payment', 's', 1, 'SPECIAL', 40, 40, '2026-01-01', '');
    INSERT INTO tracker_expenses (id, name, amount_ore, category, occurred_at, source_type, source_details) VALUES
      ('private-detached', 'Private', 1, 'Software', '2026-01-01', 'SUBSCRIPTION_PAYMENT', '{"transactionContext":"PRIVATE","inputVatOre":25,"deductibleVatOre":25,"outputVatOre":25}'),
      ('special-detached', 'Special', 1, 'Software', '2026-01-01', 'SUBSCRIPTION_PAYMENT', '{"transactionContext":"SPECIAL","inputVatOre":10,"deductibleVatOre":10,"outputVatOre":10}');`);
  const route = await source("app/api/track/vat/route.ts");
  const query = route.match(/db\.prepare\(`(SELECT[\s\S]*?)`\)\.first<\{ inputVatOre/);
  assert.ok(query, "VAT endpoint must expose its aggregate query");
  const totals = Object.fromEntries(Object.entries(db.prepare(renderContextSql(query[1])).get()));
  assert.deepEqual(totals, { inputVatOre: 360, deductibleInputVatOre: 340, outputVatOre: 400 });
  db.close();
});

test("PRIVATE UI removes VAT details while B2B/SPECIAL retain VAT controls", async () => {
  const [transactions, vat] = await Promise.all([source("app/track/TrackerTransactions.tsx"), source("app/api/track/vat/route.ts")]);
  assert.match(transactions, /if \(transactionContext === "PRIVATE"\) return null/);
  assert.match(transactions, /effectiveTransactionContext\(transaction\.transactionContext, transaction\.isB2b\)/);
  assert.match(transactions, /className="track-transaction-amount"/);
  assert.match(transactions, /className="track-transaction-vat-meta"/);
  assert.match(vat, /effectiveTransactionContextSql/);
});

test("purchase-context migration is additive and leaves historical rows untouched", async () => {
  const migration = await source("drizzle/0012_tracker_purchase_context_and_subscription_vat.sql");
  assert.match(migration, /ALTER TABLE tracker_transactions ADD COLUMN transaction_context/); assert.match(migration, /tracker_subscription_payments ADD COLUMN entered_amount_ore/);
  assert.match(migration, /idx_tracker_subscription_payments_vat_date/); assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM|UPDATE tracker_/i);
});
