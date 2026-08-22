import {
  cleanTrackerText, noStoreJson, subscriptionPaymentId, trackerDate, trackerDb,
  trackerError, trackerInteger, trackerUnavailable,
} from "../../../../lib/tracker";
import type { TrackerSubscriptionPayment } from "../../../track/types";

const paymentSelect = `p.id, p.subscription_id AS subscriptionId, s.name AS subscriptionName,
  p.amount_ore AS amountOre, p.occurred_at AS occurredAt, p.notes, p.created_at AS createdAt`;

function parsePayment(payload: Record<string, unknown>) {
  const subscriptionId = cleanTrackerText(payload.subscriptionId, 80, true);
  const amountOre = trackerInteger(payload.amountOre, { min: 1 });
  const occurredAt = trackerDate(payload.occurredAt);
  const notes = cleanTrackerText(payload.notes, 2_000) ?? "";
  return subscriptionId && amountOre !== null && occurredAt ? { subscriptionId, amountOre, occurredAt, notes } : null;
}

export async function POST(request: Request) {
  const db = trackerDb();
  if (!db) return trackerUnavailable();
  try {
    const input = parsePayment(await request.json() as Record<string, unknown>);
    if (!input) return noStoreJson({ error: "Choose a subscription and enter a positive DKK payment with a valid date.", errorCode: "INVALID_SUBSCRIPTION_PAYMENT" }, { status: 400 });
    const subscription = await db.prepare("SELECT id FROM tracker_subscriptions WHERE id = ?").bind(input.subscriptionId).first<{ id: string }>();
    if (!subscription) return noStoreJson({ error: "The selected subscription no longer exists.", errorCode: "SUBSCRIPTION_NOT_FOUND" }, { status: 404 });
    const id = subscriptionPaymentId();
    await db.prepare(`INSERT INTO tracker_subscription_payments (id, subscription_id, amount_ore, occurred_at, notes)
      VALUES (?, ?, ?, ?, ?)`).bind(id, input.subscriptionId, input.amountOre, input.occurredAt, input.notes).run();
    const payment = await db.prepare(`SELECT ${paymentSelect} FROM tracker_subscription_payments p
      JOIN tracker_subscriptions s ON s.id = p.subscription_id WHERE p.id = ?`).bind(id).first<TrackerSubscriptionPayment>();
    return noStoreJson({ payment }, { status: 201 });
  } catch (error) {
    return trackerError(error, "Unable to record the subscription payment.");
  }
}

export async function PATCH(request: Request) {
  const db = trackerDb();
  if (!db) return trackerUnavailable();
  try {
    const payload = await request.json() as Record<string, unknown>;
    const id = cleanTrackerText(payload.id, 80, true);
    const input = parsePayment(payload);
    if (!id || !input) return noStoreJson({ error: "The subscription payment update contains invalid values.", errorCode: "INVALID_SUBSCRIPTION_PAYMENT" }, { status: 400 });
    const subscription = await db.prepare("SELECT id FROM tracker_subscriptions WHERE id = ?").bind(input.subscriptionId).first<{ id: string }>();
    if (!subscription) return noStoreJson({ error: "The selected subscription no longer exists.", errorCode: "SUBSCRIPTION_NOT_FOUND" }, { status: 404 });
    const result = await db.prepare(`UPDATE tracker_subscription_payments SET subscription_id = ?, amount_ore = ?,
      occurred_at = ?, notes = ? WHERE id = ?`)
      .bind(input.subscriptionId, input.amountOre, input.occurredAt, input.notes, id).run();
    if (result.meta.changes !== 1) return noStoreJson({ error: "This payment no longer exists.", errorCode: "SUBSCRIPTION_PAYMENT_NOT_FOUND" }, { status: 404 });
    const payment = await db.prepare(`SELECT ${paymentSelect} FROM tracker_subscription_payments p
      JOIN tracker_subscriptions s ON s.id = p.subscription_id WHERE p.id = ?`).bind(id).first<TrackerSubscriptionPayment>();
    return noStoreJson({ payment });
  } catch (error) {
    return trackerError(error, "Unable to update the subscription payment.");
  }
}

export async function DELETE(request: Request) {
  const db = trackerDb();
  if (!db) return trackerUnavailable();
  try {
    const payload = await request.json() as { id?: unknown };
    const id = cleanTrackerText(payload.id, 80, true);
    if (!id) return noStoreJson({ error: "Invalid subscription payment.", errorCode: "INVALID_SUBSCRIPTION_PAYMENT" }, { status: 400 });
    const result = await db.prepare("DELETE FROM tracker_subscription_payments WHERE id = ?").bind(id).run();
    if (result.meta.changes !== 1) return noStoreJson({ error: "This payment no longer exists.", errorCode: "SUBSCRIPTION_PAYMENT_NOT_FOUND" }, { status: 404 });
    return noStoreJson({ id, deleted: true });
  } catch (error) {
    return trackerError(error, "Unable to delete the subscription payment.");
  }
}
