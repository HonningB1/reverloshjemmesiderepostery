import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import ts from "typescript";
import {
  analyticsDateRange, calendarDateInTimeZone, calculateOperatingResult, calculateProfit, calculateProfitCalculator,
  calculateVatAmounts, recalculateProductSales, remainingInventoryCost, vatPosition,
} from "../lib/tracker-accounting.ts";
import { trackerDa, trackerEn } from "../app/track/translations.ts";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");
const sale = (overrides = {}) => ({ id: "sale-a", quantity: 1, revenueOre: 150_000, feeOre: 0,
  promotedFeeOre: 0, shippingOre: 0, otherCostsOre: 0, occurredAt: "2026-02-01", createdAt: "2026-02-01T10:00:00Z", ...overrides });

test("ordinary purchase to sale uses the complete trading-profit bridge", () => {
  const purchase = calculateVatAmounts({ type: "PURCHASE", quantity: 2, enteredUnitPriceOre: 100_000,
    enteredShippingOre: 10_000, priceMode: "VAT_EXCLUSIVE", vatTreatment: "NO_VAT_OUTSIDE_SCOPE", vatRateBps: 0 });
  const ledger = recalculateProductSales({ quantity: 2, purchasePriceOre: purchase.unitPriceOre,
    purchaseShippingOre: purchase.shippingOre }, [sale({ quantity: 1, feeOre: 12_000, promotedFeeOre: 3_000,
      shippingOre: 7_000, otherCostsOre: 2_000 })]);
  assert.equal(ledger.remainingQuantity, 1);
  assert.deepEqual(ledger.sales[0], { ...sale({ quantity: 1, feeOre: 12_000, promotedFeeOre: 3_000,
    shippingOre: 7_000, otherCostsOre: 2_000 }), costBasisOre: 105_000, totalCostsOre: 129_000, netProfitOre: 21_000 });
});

test("partial and multiple sales allocate every purchase-shipping øre exactly", () => {
  const product = { quantity: 3, remainingQuantity: 3, purchasePriceOre: 100_000, purchaseShippingOre: 100 };
  const one = recalculateProductSales(product, [sale()]);
  assert.equal(one.sales[0].costBasisOre, 100_033);
  assert.equal(remainingInventoryCost({ ...product, remainingQuantity: one.remainingQuantity }), 200_067,
    "remaining inventory must equal total purchase cost minus realised cost basis");
  const all = recalculateProductSales(product, [sale(), sale({ id: "sale-b", quantity: 2, revenueOre: 300_000, occurredAt: "2026-02-02" })]);
  assert.equal(all.sales.reduce((sum, row) => sum + row.costBasisOre, 0), 300_100);
  assert.equal(remainingInventoryCost({ ...product, remainingQuantity: 0 }), 0);
});

test("sale edits, deletes, date changes and overselling recalculate the ledger", () => {
  const product = { quantity: 4, purchasePriceOre: 50_000, purchaseShippingOre: 103 };
  const initial = recalculateProductSales(product, [sale({ id: "a", quantity: 1 }), sale({ id: "b", quantity: 2, occurredAt: "2026-03-01" })]);
  assert.equal(initial.remainingQuantity, 1);
  const edited = recalculateProductSales(product, [sale({ id: "a", quantity: 2, revenueOre: 310_000, occurredAt: "2026-04-01" }), sale({ id: "b", quantity: 1, occurredAt: "2026-03-01", feeOre: 1_000 })]);
  assert.equal(edited.remainingQuantity, 1);
  assert.equal(edited.sales.find((row) => row.id === "a").quantity, 2);
  const afterDelete = recalculateProductSales(product, [sale({ id: "b", quantity: 1 })]);
  assert.equal(afterDelete.remainingQuantity, 3);
  assert.throws(() => recalculateProductSales(product, [sale({ quantity: 5 })]), /sell more units/);
});

test("purchase price, quantity and VAT treatment edits flow into inventory and every sale", () => {
  const gross = calculateVatAmounts({ type: "PURCHASE", quantity: 3, enteredUnitPriceOre: 125_000,
    enteredShippingOre: 0, priceMode: "VAT_INCLUSIVE", vatTreatment: "PRIVATE_PURCHASE_NO_DEDUCTION", vatRateBps: 2_500 });
  const deductible = calculateVatAmounts({ type: "PURCHASE", quantity: 3, enteredUnitPriceOre: 125_000,
    enteredShippingOre: 0, priceMode: "VAT_INCLUSIVE", vatTreatment: "DANISH_PURCHASE_DEDUCTIBLE", vatRateBps: 2_500 });
  const before = recalculateProductSales({ quantity: 3, purchasePriceOre: gross.unitPriceOre, purchaseShippingOre: gross.shippingOre }, [sale({ quantity: 2, revenueOre: 300_000 })]);
  const after = recalculateProductSales({ quantity: 4, purchasePriceOre: deductible.unitPriceOre, purchaseShippingOre: deductible.shippingOre }, [sale({ quantity: 2, revenueOre: 300_000 })]);
  assert.equal(before.sales[0].costBasisOre, 250_000);
  assert.equal(after.sales[0].costBasisOre, 200_000);
  assert.equal(after.remainingQuantity, 2);
  assert.throws(() => recalculateProductSales({ quantity: 1, purchasePriceOre: 100_000, purchaseShippingOre: 0 }, [sale({ quantity: 2 })]));
});

test("fees, promoted fees, shipping and other costs each reduce trading profit once", () => {
  assert.deepEqual(calculateProfit({ revenueOre: 200_000, costBasisOre: 100_000, feeOre: 10_000,
    promotedFeeOre: 5_000, shippingOre: 8_000, otherCostsOre: 2_000 }), {
    revenueOre: 200_000, costBasisOre: 100_000, feeOre: 10_000, promotedFeeOre: 5_000,
    shippingOre: 8_000, otherCostsOre: 2_000, tradingCostsOre: 125_000, tradingProfitOre: 75_000,
  });
});

test("expense and subscription-payment create, edit and delete reconcile operating and net profit", () => {
  const expenses = [{ amountOre: 10_000 }, { amountOre: 5_000 }];
  const payments = [{ amountOre: 4_000 }, { amountOre: 4_000 }];
  const snapshot = () => calculateOperatingResult({ tradingProfitOre: 100_000,
    ordinaryExpensesOre: expenses.reduce((sum, row) => sum + row.amountOre, 0),
    subscriptionPaymentsOre: payments.reduce((sum, row) => sum + row.amountOre, 0) });
  assert.equal(snapshot().netProfitOre, 77_000);
  expenses[0].amountOre = 12_000; payments[1].amountOre = 5_000;
  assert.equal(snapshot().operatingExpensesOre, 26_000);
  expenses.splice(1, 1); payments.splice(0, 1);
  assert.deepEqual(snapshot(), { ordinaryExpensesOre: 12_000, subscriptionPaymentsOre: 5_000, operatingExpensesOre: 17_000, netProfitOre: 83_000 });
});

test("subscription deletion offers atomic archive, keep-payment and delete-payment paths", async () => {
  const [route, migration] = await Promise.all([source("app/api/track/subscriptions/route.ts"), source("drizzle/0009_tracker_detached_subscription_payments.sql")]);
  assert.match(route, /mode === "ARCHIVE"/);
  assert.match(route, /mode === "DELETE_WITH_PAYMENTS"/);
  assert.match(route, /INSERT INTO tracker_expenses[\s\S]*SELECT 'exp_detached_' \|\| p\.id/);
  assert.match(route, /json_object\('subscriptionId'/);
  assert.match(route, /db\.batch/);
  assert.match(route, /confirmationName !== subscription\.name/);
  assert.match(migration, /source_type/);
  assert.match(migration, /CREATE UNIQUE INDEX idx_tracker_expenses_source/);
  assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM|UPDATE tracker_/i);
});

test("subscription deletion preserves or removes payment totals without partial ledger changes", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(await source("drizzle/0007_tracker_expenses_subscriptions.sql"));
  db.exec(await source("drizzle/0009_tracker_detached_subscription_payments.sql"));
  const addSubscription = db.prepare(`INSERT INTO tracker_subscriptions
    (id, name, cost_ore, category, billing_period, next_payment_date, auto_renew, status, notes)
    VALUES (?, ?, 40000, 'Software', 'MONTHLY', '2026-09-01', 1, 'ACTIVE', 'Original note')`);
  const addPayment = db.prepare(`INSERT INTO tracker_subscription_payments
    (id, subscription_id, amount_ore, occurred_at, notes) VALUES (?, ?, ?, ?, ?)`);
  const operatingTotal = () => db.prepare(`SELECT
    (SELECT COALESCE(SUM(amount_ore), 0) FROM tracker_expenses) +
    (SELECT COALESCE(SUM(amount_ore), 0) FROM tracker_subscription_payments) AS total`).get().total;

  addSubscription.run("sub-keep", "Keep history");
  addPayment.run("pay-1", "sub-keep", 40000, "2026-06-01", "June");
  addPayment.run("pay-2", "sub-keep", 41000, "2026-07-01", "July");
  const beforeKeep = operatingTotal();
  db.exec("BEGIN");
  db.prepare(`INSERT INTO tracker_expenses
    (id, name, amount_ore, category, occurred_at, notes, source_type, source_id, source_details, created_at, updated_at)
    SELECT 'exp_detached_' || p.id, s.name, p.amount_ore, s.category, p.occurred_at, p.notes,
      'SUBSCRIPTION_PAYMENT', p.id, json_object('subscriptionId', s.id, 'subscriptionName', s.name),
      p.created_at, CURRENT_TIMESTAMP
    FROM tracker_subscription_payments p JOIN tracker_subscriptions s ON s.id = p.subscription_id
    WHERE s.id = ?`).run("sub-keep");
  db.prepare("DELETE FROM tracker_subscription_payments WHERE subscription_id = ?").run("sub-keep");
  db.prepare("DELETE FROM tracker_subscriptions WHERE id = ?").run("sub-keep");
  db.exec("COMMIT");
  assert.equal(operatingTotal(), beforeKeep);
  assert.deepEqual(db.prepare(`SELECT name, amount_ore AS amountOre, occurred_at AS occurredAt, notes, source_id AS sourceId
    FROM tracker_expenses ORDER BY occurred_at`).all().map((row) => ({ ...row })), [
    { name: "Keep history", amountOre: 40000, occurredAt: "2026-06-01", notes: "June", sourceId: "pay-1" },
    { name: "Keep history", amountOre: 41000, occurredAt: "2026-07-01", notes: "July", sourceId: "pay-2" },
  ]);

  addSubscription.run("sub-delete", "Delete history");
  addPayment.run("pay-3", "sub-delete", 15000, "2026-08-01", "August");
  db.exec("BEGIN");
  db.prepare("DELETE FROM tracker_subscription_payments WHERE subscription_id = ?").run("sub-delete");
  db.prepare("DELETE FROM tracker_subscriptions WHERE id = ?").run("sub-delete");
  db.exec("COMMIT");
  assert.equal(operatingTotal(), beforeKeep);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM tracker_subscription_payments").get().count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM tracker_subscriptions").get().count, 0);
  db.close();
});

test("Danish VAT, EU B2B, reverse charge and settlements never double-count VAT", () => {
  const danish = calculateVatAmounts({ type: "PURCHASE", quantity: 1, enteredUnitPriceOre: 125_000,
    enteredShippingOre: 0, priceMode: "VAT_INCLUSIVE", vatTreatment: "DANISH_PURCHASE_DEDUCTIBLE", vatRateBps: 2_500 });
  const euPurchase = calculateVatAmounts({ type: "PURCHASE", quantity: 1, enteredUnitPriceOre: 100_000,
    enteredShippingOre: 0, priceMode: "VAT_EXCLUSIVE", vatTreatment: "EU_PURCHASE_REVERSE_CHARGE", vatRateBps: 2_500 });
  const b2b = calculateVatAmounts({ type: "SALE", quantity: 1, enteredUnitPriceOre: 150_000,
    enteredShippingOre: 0, priceMode: "VAT_EXCLUSIVE", vatTreatment: "EU_B2B_SALE_REVERSE_CHARGE", vatRateBps: 0 });
  assert.equal(danish.economicPurchaseCostOre, 100_000);
  assert.equal(euPurchase.economicPurchaseCostOre, 100_000);
  assert.equal(euPurchase.inputVatOre, euPurchase.outputVatOre);
  assert.equal(b2b.revenueOre, 150_000); assert.equal(b2b.outputVatOre, 0);
  assert.deepEqual(vatPosition({ deductibleInputVatOre: 25_000, outputVatOre: 0, paidSettlementsOre: 0, receivedSettlementsOre: 25_000 }), { openPositionOre: 0, receivableOre: 0, payableOre: 0 });
});

test("analytics ranges are inclusive, UTC-stable and exclude future records", () => {
  assert.deepEqual(analyticsDateRange("30D", "2026-08-22"), { since: "2026-07-24", through: "2026-08-22" });
  assert.deepEqual(analyticsDateRange("90D", "2026-08-22"), { since: "2026-05-25", through: "2026-08-22" });
  assert.deepEqual(analyticsDateRange("YTD", "2026-08-22"), { since: "2026-01-01", through: "2026-08-22" });
  assert.deepEqual(analyticsDateRange("ALL", "2026-08-22"), { since: null, through: null });
  assert.equal(calendarDateInTimeZone(new Date("2026-08-21T22:30:00Z")), "2026-08-22");
});

test("Overview and Analytics ALL use the same event scope and accounting totals", async () => {
  const [overview, analytics] = await Promise.all([source("app/api/track/overview/route.ts"), source("app/api/track/analytics/route.ts")]);
  for (const table of ["tracker_transactions", "tracker_expenses", "tracker_subscription_payments"]) {
    assert.match(overview, new RegExp(table)); assert.match(analytics, new RegExp(table));
  }
  assert.match(overview, /netProfitOre: tradingProfitOre - operatingExpensesOre/);
  assert.match(analytics, /netProfitOre: tradingProfitOre - operatingExpensesOre/);
  assert.match(analytics, /analyticsDateRange\(period/);
});

test("profit calculator uses integer-øre fee rounding and exact break-even logic", () => {
  assert.deepEqual(calculateProfitCalculator({ purchasePriceOre: 100_000, salePriceOre: 150_000,
    marketplaceFeeBps: 1_280, promotedFeeBps: 200, shippingOre: 7_000, otherCostsOre: 0, targetRoiBps: 2_500 }),
  { marketplaceFeeOre: 19_200, promotedFeeOre: 3_000, feeOre: 22_200, profitOre: 20_800, breakEvenOre: 125_587, maxPurchaseOre: 96_640 });
});

test("Starlink Mini regression preserves economic profit and VAT receivable", () => {
  const purchase = calculateVatAmounts({ type: "PURCHASE", quantity: 3, enteredUnitPriceOre: 156_125,
    enteredShippingOre: 8_625, priceMode: "VAT_INCLUSIVE", vatTreatment: "DANISH_PURCHASE_DEDUCTIBLE", vatRateBps: 2_500 });
  const b2bSale = calculateVatAmounts({ type: "SALE", quantity: 3, enteredUnitPriceOre: 193_638,
    enteredTotalPriceOre: 580_915, enteredShippingOre: 17_000, priceMode: "VAT_EXCLUSIVE",
    vatTreatment: "EU_B2B_SALE_REVERSE_CHARGE", vatRateBps: 0 });
  const ledger = recalculateProductSales({ quantity: 3, purchasePriceOre: purchase.unitPriceOre,
    purchaseShippingOre: purchase.shippingOre }, [sale({ quantity: 3, revenueOre: b2bSale.revenueOre, shippingOre: 17_000 })]);
  assert.deepEqual({ grossPurchase: purchase.grossAmountOre, deductibleVat: purchase.deductibleVatOre,
    economicCost: purchase.economicPurchaseCostOre, revenue: b2bSale.revenueOre, outputVat: b2bSale.outputVatOre,
    saleShipping: ledger.sales[0].shippingOre, tradingProfit: ledger.sales[0].netProfitOre },
  { grossPurchase: 477_000, deductibleVat: 95_400, economicCost: 381_600, revenue: 580_915,
    outputVat: 0, saleShipping: 17_000, tradingProfit: 182_315 });
  assert.deepEqual(vatPosition({ deductibleInputVatOre: purchase.deductibleVatOre, outputVatOre: 0,
    paidSettlementsOre: 0, receivedSettlementsOre: 0 }), { openPositionOre: 95_400, receivableOre: 95_400, payableOre: 0 });
});

test("English and Danish translation keys are complete and tracker literals use i18n", async () => {
  assert.deepEqual(Object.keys(trackerEn).sort(), Object.keys(trackerDa).sort());
  const files = ["TrackerApp.tsx", "TrackerExpenses.tsx", "TrackerTransactions.tsx", "TrackerVat.tsx"];
  for (const file of files) {
    const content = await source(`app/track/${file}`);
    const tree = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const usedKeys = [];
    function visit(node) {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "t" && node.arguments[0]) {
        const collect = (value) => {
          if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) usedKeys.push(value.text);
          else if (ts.isConditionalExpression(value)) { collect(value.whenTrue); collect(value.whenFalse); }
          else if (ts.isParenthesizedExpression(value)) collect(value.expression);
        };
        collect(node.arguments[0]);
      }
      if (ts.isJsxAttribute(node) && ["title", "kicker", "detail"].includes(node.name.getText(tree)) &&
          node.initializer && ts.isStringLiteral(node.initializer)) usedKeys.push(node.initializer.text);
      node.forEachChild(visit);
    }
    visit(tree);
    for (const key of usedKeys) assert.ok(key in trackerEn && key in trackerDa, `${file} is missing translation key: ${key}`);
    const directText = [...content.matchAll(/<(?:p|h1|h2|h3|small|strong|span|button|label|th|dt)[^>]*>([A-Za-z][^<>{}]*)</g)]
      .map((match) => match[1].trim()).filter(Boolean).filter((value) => !/^(DKK|ALL|ROI|B2B|A|B|C|ISO 3166-1)$/.test(value));
    assert.deepEqual(directText, [], `${file} contains obvious hardcoded user-facing text`);
  }
  const apiFiles = ["analytics", "expenses", "inventory", "overview", "subscription-payments", "subscriptions", "transactions", "vat"];
  const apiSources = await Promise.all(apiFiles.map((file) => source(`app/api/track/${file}/route.ts`)));
  apiSources.push(await source("lib/tracker.ts"));
  for (const [index, content] of apiSources.entries()) {
    const errorCodes = [...content.matchAll(/errorCode:\s*"([A-Z0-9_]+)"/g)].map((match) => match[1]);
    for (const code of errorCodes) assert.ok(code in trackerEn && code in trackerDa,
      `${apiFiles[index] ?? "lib/tracker.ts"} has an untranslated API error code: ${code}`);
  }
});
