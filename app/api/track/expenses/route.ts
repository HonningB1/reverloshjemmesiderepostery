import {
  cleanTrackerText, expenseId, noStoreJson, trackerDate, trackerDb, trackerError,
  trackerInteger, trackerUnavailable,
} from "../../../../lib/tracker";
import type {
  ExpensesData, TrackerExpense, TrackerSubscription, TrackerSubscriptionPayment,
} from "../../../track/types";

const expenseSelect = `id, name, amount_ore AS amountOre, category, occurred_at AS occurredAt,
  notes, source_type AS sourceType, source_id AS sourceId, source_details AS sourceDetails,
  created_at AS createdAt, updated_at AS updatedAt`;
const subscriptionSelect = `s.id, s.name, s.cost_ore AS costOre, s.category,
  s.billing_period AS billingPeriod, s.next_payment_date AS nextPaymentDate,
  s.auto_renew AS autoRenew, s.status, s.notes, s.created_at AS createdAt, s.updated_at AS updatedAt,
  COALESCE(SUM(p.amount_ore), 0) AS paidTotalOre, COUNT(p.id) AS paymentCount`;
const paymentSelect = `p.id, p.subscription_id AS subscriptionId, s.name AS subscriptionName,
  p.amount_ore AS amountOre, p.occurred_at AS occurredAt, p.notes, p.created_at AS createdAt`;

type Totals = { ordinaryExpensesOre: number; subscriptionExpensesOre: number };

export async function GET() {
  const db = trackerDb();
  if (!db) return trackerUnavailable();
  try {
    const [expenses, subscriptions, payments, totals] = await Promise.all([
      db.prepare(`SELECT ${expenseSelect} FROM tracker_expenses ORDER BY occurred_at DESC, created_at DESC`).all<TrackerExpense>(),
      db.prepare(`SELECT ${subscriptionSelect} FROM tracker_subscriptions s
        LEFT JOIN tracker_subscription_payments p ON p.subscription_id = s.id
        GROUP BY s.id ORDER BY CASE s.status WHEN 'ACTIVE' THEN 0 ELSE 1 END,
        s.next_payment_date ASC, s.updated_at DESC`).all<TrackerSubscription>(),
      db.prepare(`SELECT ${paymentSelect} FROM tracker_subscription_payments p
        JOIN tracker_subscriptions s ON s.id = p.subscription_id
        ORDER BY p.occurred_at DESC, p.created_at DESC`).all<TrackerSubscriptionPayment>(),
      db.prepare(`SELECT
        (SELECT COALESCE(SUM(amount_ore), 0) FROM tracker_expenses) AS ordinaryExpensesOre,
        (SELECT COALESCE(SUM(amount_ore), 0) FROM tracker_subscription_payments) AS subscriptionExpensesOre`).first<Totals>(),
    ]);
    const ordinaryExpensesOre = Number(totals?.ordinaryExpensesOre ?? 0);
    const subscriptionExpensesOre = Number(totals?.subscriptionExpensesOre ?? 0);
    const data: ExpensesData = {
      expenses: expenses.results,
      subscriptions: subscriptions.results.map((subscription) => ({
        ...subscription,
        autoRenew: Boolean(subscription.autoRenew),
        paidTotalOre: Number(subscription.paidTotalOre),
        paymentCount: Number(subscription.paymentCount),
      })),
      payments: payments.results,
      totals: {
        ordinaryExpensesOre,
        subscriptionExpensesOre,
        operatingExpensesOre: ordinaryExpensesOre + subscriptionExpensesOre,
        activeSubscriptions: subscriptions.results.filter((subscription) => subscription.status === "ACTIVE").length,
      },
    };
    return noStoreJson(data);
  } catch (error) {
    return trackerError(error, "Unable to load expenses and subscriptions.");
  }
}

function parseExpense(payload: Record<string, unknown>) {
  const name = cleanTrackerText(payload.name, 160, true);
  const amountOre = trackerInteger(payload.amountOre, { min: 1 });
  const category = cleanTrackerText(payload.category, 80, true);
  const occurredAt = trackerDate(payload.occurredAt);
  const notes = cleanTrackerText(payload.notes, 2_000) ?? "";
  return name && amountOre !== null && category && occurredAt ? { name, amountOre, category, occurredAt, notes } : null;
}

export async function POST(request: Request) {
  const db = trackerDb();
  if (!db) return trackerUnavailable();
  try {
    const input = parseExpense(await request.json() as Record<string, unknown>);
    if (!input) return noStoreJson({ error: "Complete the expense with a name, positive DKK amount, category and valid date.", errorCode: "INVALID_EXPENSE" }, { status: 400 });
    const id = expenseId();
    await db.prepare(`INSERT INTO tracker_expenses (id, name, amount_ore, category, occurred_at, notes)
      VALUES (?, ?, ?, ?, ?, ?)`).bind(id, input.name, input.amountOre, input.category, input.occurredAt, input.notes).run();
    const expense = await db.prepare(`SELECT ${expenseSelect} FROM tracker_expenses WHERE id = ?`).bind(id).first<TrackerExpense>();
    return noStoreJson({ expense }, { status: 201 });
  } catch (error) {
    return trackerError(error, "Unable to save the expense.");
  }
}

export async function PATCH(request: Request) {
  const db = trackerDb();
  if (!db) return trackerUnavailable();
  try {
    const payload = await request.json() as Record<string, unknown>;
    const id = cleanTrackerText(payload.id, 80, true);
    const input = parseExpense(payload);
    if (!id || !input) return noStoreJson({ error: "The expense update contains invalid values.", errorCode: "INVALID_EXPENSE" }, { status: 400 });
    const result = await db.prepare(`UPDATE tracker_expenses SET name = ?, amount_ore = ?, category = ?,
      occurred_at = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .bind(input.name, input.amountOre, input.category, input.occurredAt, input.notes, id).run();
    if (result.meta.changes !== 1) return noStoreJson({ error: "This expense no longer exists.", errorCode: "EXPENSE_NOT_FOUND" }, { status: 404 });
    const expense = await db.prepare(`SELECT ${expenseSelect} FROM tracker_expenses WHERE id = ?`).bind(id).first<TrackerExpense>();
    return noStoreJson({ expense });
  } catch (error) {
    return trackerError(error, "Unable to update the expense.");
  }
}

export async function DELETE(request: Request) {
  const db = trackerDb();
  if (!db) return trackerUnavailable();
  try {
    const payload = await request.json() as { id?: unknown };
    const id = cleanTrackerText(payload.id, 80, true);
    if (!id) return noStoreJson({ error: "Invalid expense.", errorCode: "INVALID_EXPENSE" }, { status: 400 });
    const result = await db.prepare("DELETE FROM tracker_expenses WHERE id = ?").bind(id).run();
    if (result.meta.changes !== 1) return noStoreJson({ error: "This expense no longer exists.", errorCode: "EXPENSE_NOT_FOUND" }, { status: 404 });
    return noStoreJson({ id, deleted: true });
  } catch (error) {
    return trackerError(error, "Unable to delete the expense.");
  }
}
