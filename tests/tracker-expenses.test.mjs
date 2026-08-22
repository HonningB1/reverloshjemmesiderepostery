import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("operating expense migration is additive, isolated, and stores integer øre", async () => {
  const [migration, schema] = await Promise.all([
    source("drizzle/0007_tracker_expenses_subscriptions.sql"),
    source("db/schema.ts"),
  ]);
  assert.match(migration, /CREATE TABLE `tracker_expenses`/);
  assert.match(migration, /CREATE TABLE `tracker_subscriptions`/);
  assert.match(migration, /CREATE TABLE `tracker_subscription_payments`/);
  assert.match(migration, /amount_ore/);
  assert.match(migration, /ON DELETE restrict/);
  assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM|UPDATE `(?:reviews|review_links|ebay_feedback|tracker_products|tracker_transactions)`/i);
  assert.match(schema, /trackerExpenses = sqliteTable/);
  assert.match(schema, /trackerSubscriptions = sqliteTable/);
  assert.match(schema, /trackerSubscriptionPayments = sqliteTable/);
});

test("subscription definitions never post expenses automatically", async () => {
  const [subscriptions, payments, overview, analytics] = await Promise.all([
    source("app/api/track/subscriptions/route.ts"),
    source("app/api/track/subscription-payments/route.ts"),
    source("app/api/track/overview/route.ts"),
    source("app/api/track/analytics/route.ts"),
  ]);
  const subscriptionCreate = subscriptions.slice(subscriptions.indexOf("export async function POST"), subscriptions.indexOf("export async function PATCH"));
  assert.doesNotMatch(subscriptionCreate, /INSERT INTO tracker_(?:expenses|subscription_payments)/);
  assert.match(subscriptions, /KEEP_PAYMENTS/);
  assert.match(payments, /INSERT INTO tracker_subscription_payments/);
  assert.match(overview, /tracker_expenses/);
  assert.match(overview, /tracker_subscription_payments/);
  assert.doesNotMatch(overview, /SUM\(cost_ore\)/);
  assert.match(overview, /netProfitOre: tradingProfitOre - operatingExpensesOre/);
  assert.doesNotMatch(analytics, /SUM\(cost_ore\)/);
  assert.match(analytics, /netProfitOre: tradingProfitOre - operatingExpensesOre/);
});

test("expenses UI uses the existing private tracker language and designed dialogs", async () => {
  const [app, expenses] = await Promise.all([
    source("app/track/TrackerApp.tsx"),
    source("app/track/TrackerExpenses.tsx"),
  ]);
  assert.match(app, /id: "expenses", label: "Expenses"/);
  assert.match(app, /Trading profit/);
  assert.match(app, /Operating expenses/);
  assert.match(app, /Net profit/);
  assert.match(expenses, /Subscription payment history/);
  assert.match(expenses, /Payments are never created automatically/);
  assert.doesNotMatch(expenses, /\balert\s*\(|\bconfirm\s*\(/);
});

test("expense, subscription, and payment APIs remain under the private tracker namespace", async () => {
  const files = await Promise.all([
    source("app/api/track/expenses/route.ts"),
    source("app/api/track/subscriptions/route.ts"),
    source("app/api/track/subscription-payments/route.ts"),
  ]);
  for (const file of files) {
    assert.doesNotMatch(file, /api\/admin|review_links|ebay_feedback/);
    assert.match(file, /trackerDb\(\)/);
    assert.match(file, /noStoreJson/);
  }
});
