import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { nextSubscriptionPaymentDateAfterRecordedPayment } from "../lib/tracker-subscription-schedule.ts";
import { automaticSubscriptionPaymentId } from "../lib/tracker-subscription-renewals.ts";

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

test("subscription definitions do not post an immediate expense before their renewal date", async () => {
  const [subscriptions, payments, overview, analytics] = await Promise.all([
    source("app/api/track/subscriptions/route.ts"),
    source("app/api/track/subscription-payments/route.ts"),
    source("app/api/track/overview/route.ts"),
    source("app/api/track/analytics/route.ts"),
  ]);
  const subscriptionCreate = subscriptions.slice(subscriptions.indexOf("export async function POST"), subscriptions.indexOf("export async function PATCH"));
  assert.doesNotMatch(subscriptionCreate, /INSERT INTO tracker_expenses/);
  assert.match(subscriptionCreate, /payload\.initialPayment === undefined/);
  assert.match(subscriptions, /KEEP_PAYMENTS/);
  assert.match(payments, /createTrackerSubscriptionPaymentStatement/);
  assert.match(overview, /tracker_expenses/);
  assert.match(overview, /tracker_subscription_payments/);
  assert.doesNotMatch(overview, /SUM\(cost_ore\)/);
  assert.match(overview, /netProfitOre: tradingProfitOre - operatingExpensesOre/);
  assert.doesNotMatch(analytics, /SUM\(cost_ore\)/);
  assert.match(analytics, /netProfitOre: tradingProfitOre - operatingExpensesOre/);
});

test("recording an actual auto-renewing payment advances the plan without creating future expenses", async () => {
  const schedule = { billingPeriod: "MONTHLY", nextPaymentDate: "2026-08-25", autoRenew: true, status: "ACTIVE" };
  assert.equal(nextSubscriptionPaymentDateAfterRecordedPayment(schedule, "2026-08-27"), "2026-09-25");
  assert.equal(nextSubscriptionPaymentDateAfterRecordedPayment({ ...schedule, nextPaymentDate: "2026-01-31" }, "2026-03-02"), "2026-03-31");
  assert.equal(nextSubscriptionPaymentDateAfterRecordedPayment({ ...schedule, autoRenew: false }, "2026-08-27"), "2026-08-25");
  assert.equal(nextSubscriptionPaymentDateAfterRecordedPayment({ ...schedule, billingPeriod: "CUSTOM" }, "2026-08-27"), "2026-08-25");

  const [payments, expenses] = await Promise.all([
    source("app/api/track/subscription-payments/route.ts"), source("app/track/TrackerExpenses.tsx"),
  ]);
  assert.match(payments, /nextSubscriptionPaymentDateAfterRecordedPayment/);
  assert.match(payments, /UPDATE tracker_subscriptions SET next_payment_date/);
  assert.match(payments, /await db\.batch\(paymentStatements/);
  assert.match(expenses, /subscriptionDueState/);
  assert.match(expenses, /Overdue by \{count\} days/);
});

test("automatic renewal uses an idempotent due-date payment and only advances after it exists", async () => {
  assert.equal(automaticSubscriptionPaymentId("sub_revolut", "2026-08-25"), "subpay_auto_sub_revolut_2026-08-25");
  const [renewals, worker] = await Promise.all([
    source("lib/tracker-subscription-renewals.ts"), source("worker/index.ts"),
  ]);
  assert.match(renewals, /INSERT OR IGNORE INTO tracker_subscription_payments/);
  assert.match(renewals, /WHERE NOT EXISTS \(SELECT 1 FROM tracker_subscription_payments WHERE subscription_id = \? AND occurred_at = \?\)/);
  assert.match(renewals, /AND EXISTS \(SELECT 1 FROM tracker_subscription_payments WHERE subscription_id = \? AND occurred_at = \?\)/);
  assert.match(renewals, /transaction_context, occurred_at, notes\)[\s\S]*'PRIVATE', \?, 'Automatic renewal'/);
  assert.match(renewals, /billing_period <> 'CUSTOM'/);
  assert.match(worker, /syncTrackerSubscriptionRenewals\(env\.DB\)/);
  assert.match(worker, /Promise\.allSettled/);
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
  assert.match(expenses, /A payment is recorded automatically on each renewal date/);
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
