import {
  cleanTrackerText, noStoreJson, subscriptionId, trackerDate, trackerDb, trackerError,
  trackerInteger, trackerUnavailable,
} from "../../../../lib/tracker";
import { billingPeriods, type BillingPeriod, type SubscriptionStatus, type TrackerSubscription } from "../../../track/types";

const statuses = ["ACTIVE", "ARCHIVED"] as const;
const subscriptionSelect = `s.id, s.name, s.cost_ore AS costOre, s.category,
  s.billing_period AS billingPeriod, s.next_payment_date AS nextPaymentDate,
  s.auto_renew AS autoRenew, s.status, s.notes, s.created_at AS createdAt, s.updated_at AS updatedAt,
  COALESCE(SUM(p.amount_ore), 0) AS paidTotalOre, COUNT(p.id) AS paymentCount`;

function parseSubscription(payload: Record<string, unknown>) {
  const name = cleanTrackerText(payload.name, 160, true);
  const costOre = trackerInteger(payload.costOre, { min: 1 });
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

async function selectedSubscription(db: D1Database, id: string) {
  const subscription = await db.prepare(`SELECT ${subscriptionSelect} FROM tracker_subscriptions s
    LEFT JOIN tracker_subscription_payments p ON p.subscription_id = s.id WHERE s.id = ? GROUP BY s.id`)
    .bind(id).first<TrackerSubscription>();
  return subscription ? {
    ...subscription,
    autoRenew: Boolean(subscription.autoRenew),
    paidTotalOre: Number(subscription.paidTotalOre),
    paymentCount: Number(subscription.paymentCount),
  } : null;
}

export async function POST(request: Request) {
  const db = trackerDb();
  if (!db) return trackerUnavailable();
  try {
    const input = parseSubscription(await request.json() as Record<string, unknown>);
    if (!input) return noStoreJson({ error: "Complete the subscription with a name, positive DKK cost, category, billing period and renewal date.", errorCode: "INVALID_SUBSCRIPTION" }, { status: 400 });
    const id = subscriptionId();
    await db.prepare(`INSERT INTO tracker_subscriptions
      (id, name, cost_ore, category, billing_period, next_payment_date, auto_renew, status, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, input.name, input.costOre, input.category, input.billingPeriod, input.nextPaymentDate,
        input.autoRenew ? 1 : 0, input.status, input.notes).run();
    return noStoreJson({ subscription: await selectedSubscription(db, id) }, { status: 201 });
  } catch (error) {
    return trackerError(error, "Unable to save the subscription.");
  }
}

export async function PATCH(request: Request) {
  const db = trackerDb();
  if (!db) return trackerUnavailable();
  try {
    const payload = await request.json() as Record<string, unknown>;
    const id = cleanTrackerText(payload.id, 80, true);
    const input = parseSubscription(payload);
    if (!id || !input) return noStoreJson({ error: "The subscription update contains invalid values.", errorCode: "INVALID_SUBSCRIPTION" }, { status: 400 });
    const result = await db.prepare(`UPDATE tracker_subscriptions SET name = ?, cost_ore = ?, category = ?,
      billing_period = ?, next_payment_date = ?, auto_renew = ?, status = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`).bind(input.name, input.costOre, input.category, input.billingPeriod, input.nextPaymentDate,
        input.autoRenew ? 1 : 0, input.status, input.notes, id).run();
    if (result.meta.changes !== 1) return noStoreJson({ error: "This subscription no longer exists.", errorCode: "SUBSCRIPTION_NOT_FOUND" }, { status: 404 });
    return noStoreJson({ subscription: await selectedSubscription(db, id) });
  } catch (error) {
    return trackerError(error, "Unable to update the subscription.");
  }
}

export async function DELETE(request: Request) {
  const db = trackerDb();
  if (!db) return trackerUnavailable();
  try {
    const payload = await request.json() as Record<string, unknown>;
    const id = cleanTrackerText(payload.id, 80, true);
    const mode = payload.mode === "ARCHIVE" || payload.mode === "KEEP_PAYMENTS" || payload.mode === "DELETE_WITH_PAYMENTS"
      ? payload.mode : null;
    if (!id || !mode) return noStoreJson({ error: "Invalid subscription deletion request.", errorCode: "INVALID_SUBSCRIPTION_DELETE" }, { status: 400 });
    const subscription = await selectedSubscription(db, id);
    if (!subscription) return noStoreJson({ error: "This subscription no longer exists.", errorCode: "SUBSCRIPTION_NOT_FOUND" }, { status: 404 });

    if (mode === "ARCHIVE") {
      const result = await db.prepare("UPDATE tracker_subscriptions SET status = 'ARCHIVED', auto_renew = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(id).run();
      if (result.meta.changes !== 1) return noStoreJson({ error: "This subscription changed while the request was being processed.", errorCode: "SUBSCRIPTION_CONFLICT" }, { status: 409 });
      return noStoreJson({ id, archived: true, paymentCount: subscription.paymentCount, paymentTotalOre: subscription.paidTotalOre });
    }

    if (mode === "DELETE_WITH_PAYMENTS") {
      const confirmationName = typeof payload.confirmationName === "string" ? payload.confirmationName : "";
      if (confirmationName !== subscription.name) return noStoreJson({
        error: "Type the exact subscription name to confirm permanent deletion.", errorCode: "SUBSCRIPTION_CONFIRMATION_MISMATCH",
      }, { status: 400 });
      const results = await db.batch([
        db.prepare(`DELETE FROM tracker_subscription_payments WHERE subscription_id =
          (SELECT id FROM tracker_subscriptions WHERE id = ? AND name = ?)`).bind(id, confirmationName),
        db.prepare("DELETE FROM tracker_subscriptions WHERE id = ? AND name = ?").bind(id, confirmationName),
      ]);
      if (results[1]?.meta.changes !== 1) return noStoreJson({ error: "This subscription changed while the request was being processed.", errorCode: "SUBSCRIPTION_CONFLICT" }, { status: 409 });
      return noStoreJson({ id, deleted: true, paymentsDeleted: subscription.paymentCount, paymentTotalOre: subscription.paidTotalOre });
    }

    const results = await db.batch([
      db.prepare(`INSERT INTO tracker_expenses
        (id, name, amount_ore, category, occurred_at, notes, source_type, source_id, source_details, created_at, updated_at)
        SELECT 'exp_detached_' || p.id, s.name, p.amount_ore, s.category, p.occurred_at, p.notes,
          'SUBSCRIPTION_PAYMENT', p.id,
          json_object('subscriptionId', s.id, 'subscriptionName', s.name, 'costOre', s.cost_ore,
            'category', s.category, 'billingPeriod', s.billing_period, 'nextPaymentDate', s.next_payment_date,
            'autoRenew', s.auto_renew, 'status', s.status, 'subscriptionNotes', s.notes),
          p.created_at, CURRENT_TIMESTAMP
        FROM tracker_subscription_payments p JOIN tracker_subscriptions s ON s.id = p.subscription_id
        WHERE s.id = ?`).bind(id),
      db.prepare("DELETE FROM tracker_subscription_payments WHERE subscription_id = ?").bind(id),
      db.prepare("DELETE FROM tracker_subscriptions WHERE id = ?").bind(id),
    ]);
    if (results[2]?.meta.changes !== 1) return noStoreJson({ error: "This subscription changed while the request was being processed.", errorCode: "SUBSCRIPTION_CONFLICT" }, { status: 409 });
    return noStoreJson({ id, deleted: true, paymentsKept: subscription.paymentCount, paymentTotalOre: subscription.paidTotalOre });
  } catch (error) {
    return trackerError(error, "Unable to delete the subscription.");
  }
}
