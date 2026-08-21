import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { analyseResellTrack, buildImportSql, dkkToOre } from "../scripts/import-reselltrack.mjs";

function fixture() {
  return {
    inventory: [{
      id: 1001,
      name: "Test product",
      purchaseQty: 2,
      qty: 1,
      buyPrice: Number("2018.190000000000054"),
      rawBuyPrice: 1993.19,
      currency: "DKK",
      shipping: 50,
      rawShipping: 50,
      shippingCurrency: "DKK",
      platform: "Supplier",
      buyDate: "2026-01-02",
      note: "Keep this product note",
    }],
    sales: [{
      id: 2001,
      productId: 1001,
      name: "Test product",
      qty: 1,
      unitSalePrice: 3000,
      salePrice: 3000,
      revenueDkk: 3000,
      costPrice: 2018.19,
      fee: 100,
      shipping: 50,
      sellingExpenses: 175,
      profit: 806.81,
      platform: "eBay",
      saleStatus: "Gennemført",
      date: "2026-02-03",
      note: "",
    }],
    settings: { currency: "DKK" },
    expenses: [{ id: 3001, name: "Proxy service", amount: 10, rawAmount: 10, currency: "DKK", eurRate: 1, cat: "Proxies", date: "2026-02-01", note: "" }],
    subs: [{ id: 4001, name: "Monthly tool", cost: 50, rawCost: 50, currency: "DKK", period: "1", expire: "2026-03-01", auto: "Ja", cat: "Software", note: "", status: "Aktiv", archived: false,
      payments: [{ id: 4002, date: "2026-02-01", amount: 50, rawAmount: 50, currency: "DKK" }] }],
    revolut: [], vatSettlements: [], listings: [], notifications: [],
  };
}

test("money values with floating-point noise round to integer øre", () => {
  assert.equal(dkkToOre(Number("2018.190000000000054")), 201819);
  assert.equal(dkkToOre(13.305322), 1331);
  assert.equal(dkkToOre(-1), null);
});

test("ResellTrack records map to deterministic products, purchases, and recalculated sales", () => {
  const analysis = analyseResellTrack(fixture());
  assert.equal(analysis.canApply, true);
  assert.deepEqual(analysis.summary, {
    productsFound: 1,
    purchasesToCreate: 1,
    salesToCreate: 1,
    unitsPurchased: 2,
    unitsSold: 1,
    remainingInventory: 1,
    purchaseCostOre: 403638,
    revenueOre: 300000,
    costBasisOre: 201819,
    feesOre: 10000,
    shippingOre: 5000,
    otherSalesCostsOre: 2500,
    totalSalesCostsOre: 17500,
    tradingProfitOre: 80681,
    expensesToCreate: 1,
    subscriptionsToCreate: 1,
    subscriptionPaymentsToCreate: 1,
    ordinaryExpensesOre: 1000,
    subscriptionExpensesOre: 5000,
    operatingExpensesOre: 6000,
    netProfitOre: 74681,
  });
  assert.equal(analysis.products[0].id, "prd_rst_1001");
  assert.equal(analysis.products[0].purchasePriceOre, 199319);
  assert.equal(analysis.products[0].purchaseShippingOre, 5000);
  assert.equal(analysis.sales[0].netProfitOre, 80681);
  assert.equal(analysis.subscriptions[0].costOre, 5000);
  assert.equal(analysis.subscriptionPayments[0].amountOre, 5000);
  assert.equal(analysis.summary.operatingExpensesOre, 6000, "planned subscription cost must not be counted in addition to its payment");
});

test("inventory mismatches and overselling block the whole import", () => {
  const data = fixture();
  data.inventory[0].qty = 2;
  data.sales[0].qty = 3;
  data.sales[0].unitSalePrice = 1000;
  data.sales[0].salePrice = 3000;
  data.sales[0].revenueDkk = 3000;
  data.sales[0].costPrice = 6054.57;
  data.sales[0].profit = 0;
  const analysis = analyseResellTrack(data);
  assert.equal(analysis.canApply, false);
  assert.match(analysis.issues.map((issue) => issue.message).join("\n"), /oversold|Inventory mismatch/);
  assert.throws(() => buildImportSql(analysis), /critical validation issues/);
});

test("generated import SQL uses an import ledger and deterministic primary keys", () => {
  const analysis = analyseResellTrack(fixture());
  const sql = buildImportSql(analysis);
  assert.match(sql, /INSERT INTO tracker_imports/);
  assert.match(sql, /tracker_imports.*source_sha256/);
  assert.match(sql, /prd_rst_1001/);
  assert.match(sql, /txn_rst_purchase_1001/);
  assert.match(sql, /txn_rst_sale_2001/);
  assert.match(sql, /INSERT INTO tracker_expenses/);
  assert.match(sql, /INSERT INTO tracker_subscriptions/);
  assert.match(sql, /INSERT INTO tracker_subscription_payments/);
  assert.doesNotMatch(sql, /revolut|vatSettlements/);
});

test("import ledger migration is additive and isolated from public Reverlo data", async () => {
  const migration = await readFile(new URL("../drizzle/0006_tracker_import_ledger.sql", import.meta.url), "utf8");
  const schema = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8");
  assert.match(migration, /CREATE TABLE `tracker_imports`/);
  assert.match(migration, /tracker_imports_source_sha256_unique/);
  assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM|UPDATE `(?:reviews|review_links|ebay_feedback|social_profiles)`/i);
  assert.match(schema, /trackerImports = sqliteTable/);
});

test("generated SQL imports every supported record and rejects an identical second import", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    for (const migrationName of ["0005_private_reselling_tracker.sql", "0006_tracker_import_ledger.sql", "0007_tracker_expenses_subscriptions.sql"]) {
      const migration = await readFile(new URL(`../drizzle/${migrationName}`, import.meta.url), "utf8");
      db.exec(migration.replaceAll("--> statement-breakpoint", ""));
    }
    const analysis = analyseResellTrack(fixture());
    const sql = buildImportSql(analysis);
    db.exec(sql);
    assert.deepEqual({ ...db.prepare(`SELECT
      (SELECT COUNT(*) FROM tracker_products) AS products,
      (SELECT COUNT(*) FROM tracker_transactions WHERE type = 'PURCHASE') AS purchases,
      (SELECT COUNT(*) FROM tracker_transactions WHERE type = 'SALE') AS sales,
      (SELECT COUNT(*) FROM tracker_expenses) AS expenses,
      (SELECT COUNT(*) FROM tracker_subscriptions) AS subscriptions,
      (SELECT COUNT(*) FROM tracker_subscription_payments) AS payments`).get() },
    { products: 1, purchases: 1, sales: 1, expenses: 1, subscriptions: 1, payments: 1 });
    assert.equal(db.prepare("SELECT SUM(amount_ore) AS total FROM tracker_expenses").get().total, 1000);
    assert.equal(db.prepare("SELECT SUM(amount_ore) AS total FROM tracker_subscription_payments").get().total, 5000);
    assert.throws(() => db.exec(sql), /UNIQUE constraint failed/);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM tracker_products").get().count, 1);
  } finally {
    db.close();
  }
});
