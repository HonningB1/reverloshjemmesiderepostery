import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  calculateVatAmounts, recalculateProductSales, vatPosition,
} from "../lib/tracker-accounting.ts";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

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

test("private and outside-scope purchases never claim deductible VAT", () => {
  const privatePurchase = calculateVatAmounts({
    type: "PURCHASE", quantity: 1, enteredUnitPriceOre: 125_000, enteredShippingOre: 0,
    priceMode: "VAT_INCLUSIVE", vatTreatment: "PRIVATE_PURCHASE_NO_DEDUCTION", vatRateBps: 2_500,
  });
  assert.equal(privatePurchase.inputVatOre, 25_000);
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

test("language choice and Starlink repair are explicit, persisted and dry-run safe", async () => {
  const [i18n, repair] = await Promise.all([source("app/track/i18n.tsx"), source("scripts/repair-starlink-vat.mjs")]);
  assert.match(i18n, /reverlo-tracker-locale/);
  assert.match(i18n, /"da"/);
  assert.match(repair, /DRY RUN — no D1 writes/);
  assert.match(repair, /Supplier country remains unset/);
  assert.match(repair, /2 = \(/);
  assert.match(repair, /--confirm/);
});
