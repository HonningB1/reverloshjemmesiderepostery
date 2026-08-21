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
    if (!input) return noStoreJson({ error: "Complete the subscription with a name, positive DKK cost, category, billing period and renewal date." }, { status: 400 });
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
    if (!id || !input) return noStoreJson({ error: "The subscription update contains invalid values." }, { status: 400 });
    const result = await db.prepare(`UPDATE tracker_subscriptions SET name = ?, cost_ore = ?, category = ?,
      billing_period = ?, next_payment_date = ?, auto_renew = ?, status = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`).bind(input.name, input.costOre, input.category, input.billingPeriod, input.nextPaymentDate,
        input.autoRenew ? 1 : 0, input.status, input.notes, id).run();
    if (result.meta.changes !== 1) return noStoreJson({ error: "This subscription no longer exists." }, { status: 404 });
    return noStoreJson({ subscription: await selectedSubscription(db, id) });
  } catch (error) {
    return trackerError(error, "Unable to update the subscription.");
  }
}
