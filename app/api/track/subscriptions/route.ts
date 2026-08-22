import {
  cleanTrackerText, noStoreJson, trackerDb, trackerError, trackerUnavailable,
} from "../../../../lib/tracker";
import { createTrackerSubscriptionStatements, parseTrackerSubscriptionInput, parseTrackerSubscriptionPaymentInput } from "../../../../lib/tracker-subscriptions";
import type { TrackerSubscription } from "../../../track/types";
const subscriptionSelect = `s.id, s.name, s.cost_ore AS costOre, s.category,
  s.billing_period AS billingPeriod, s.next_payment_date AS nextPaymentDate,
  s.auto_renew AS autoRenew, s.status, s.notes, s.created_at AS createdAt, s.updated_at AS updatedAt,
  COALESCE(SUM(CASE WHEN p.transaction_context = 'PRIVATE' THEN COALESCE(p.entered_amount_ore, p.gross_amount_ore, p.amount_ore) ELSE p.amount_ore END), 0) AS paidTotalOre, COUNT(p.id) AS paymentCount`;

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
    const payload = await request.json() as Record<string, unknown>; const input = parseTrackerSubscriptionInput(payload);
    if (!input) return noStoreJson({ error: "Complete the subscription with a name, positive DKK cost, category, billing period and renewal date.", errorCode: "INVALID_SUBSCRIPTION" }, { status: 400 });
    const payment = payload.initialPayment === undefined ? null : payload.initialPayment && typeof payload.initialPayment === "object"
      ? parseTrackerSubscriptionPaymentInput(payload.initialPayment as Record<string, unknown>) : null;
    if (payload.initialPayment !== undefined && !payment) return noStoreJson({ error: "The initial subscription payment or VAT details are invalid.", errorCode: "INVALID_SUBSCRIPTION_PAYMENT" }, { status: 400 });
    const created = createTrackerSubscriptionStatements(db, input, payment ?? undefined); await db.batch(created.statements);
    return noStoreJson({ subscription: await selectedSubscription(db, created.subscriptionId), paymentId: created.paymentId }, { status: 201 });
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
    const input = parseTrackerSubscriptionInput(payload);
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
        SELECT 'exp_detached_' || p.id, s.name,
          CASE WHEN p.transaction_context = 'PRIVATE' THEN COALESCE(p.entered_amount_ore, p.gross_amount_ore, p.amount_ore) ELSE p.amount_ore END,
          s.category, p.occurred_at, p.notes,
          'SUBSCRIPTION_PAYMENT', p.id,
          json_object('subscriptionId', s.id, 'subscriptionName', s.name, 'costOre', s.cost_ore,
            'category', s.category, 'billingPeriod', s.billing_period, 'nextPaymentDate', s.next_payment_date,
            'autoRenew', s.auto_renew, 'status', s.status, 'subscriptionNotes', s.notes,
            'enteredAmountOre', p.entered_amount_ore, 'priceMode', p.price_mode,
            'vatTreatment', p.vat_treatment, 'vatRateBps', p.vat_rate_bps,
            'grossAmountOre', p.gross_amount_ore, 'inputVatOre', p.input_vat_ore,
            'outputVatOre', p.output_vat_ore, 'deductibleVatOre', p.deductible_vat_ore,
            'supplierCountry', p.supplier_country, 'transactionContext', p.transaction_context),
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
