import {
  cleanTrackerText, noStoreJson, trackerDb, trackerError, trackerUnavailable,
} from "../../../../lib/tracker";
import { effectiveTransactionContextSql } from "../../../../lib/tracker-context";
import { nextSubscriptionPaymentDateAfterRecordedPayment } from "../../../../lib/tracker-subscription-schedule";
import { createTrackerSubscriptionPaymentStatement, parseTrackerSubscriptionPaymentInput } from "../../../../lib/tracker-subscriptions";
import type { TrackerSubscriptionPayment } from "../../../track/types";

const paymentSelect = `p.id, p.subscription_id AS subscriptionId, s.name AS subscriptionName,
  CASE WHEN ${effectiveTransactionContextSql("p.transaction_context")} = 'PRIVATE' THEN COALESCE(p.entered_amount_ore, p.gross_amount_ore, p.amount_ore) ELSE p.amount_ore END AS amountOre,
  p.occurred_at AS occurredAt, p.notes, p.created_at AS createdAt`;

type PaymentSubscription = {
  id: string;
  billingPeriod: "WEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY" | "CUSTOM";
  nextPaymentDate: string;
  autoRenew: number;
  status: "ACTIVE" | "ARCHIVED";
};

async function paymentSubscription(db: D1Database, id: string) {
  return db.prepare(`SELECT id, billing_period AS billingPeriod, next_payment_date AS nextPaymentDate,
    auto_renew AS autoRenew, status FROM tracker_subscriptions WHERE id = ?`).bind(id).first<PaymentSubscription>();
}

function paymentStatements(db: D1Database, subscription: PaymentSubscription, occurredAt: string, paymentStatement: D1PreparedStatement) {
  const nextPaymentDate = nextSubscriptionPaymentDateAfterRecordedPayment({
    billingPeriod: subscription.billingPeriod, nextPaymentDate: subscription.nextPaymentDate,
    autoRenew: Boolean(subscription.autoRenew), status: subscription.status,
  }, occurredAt);
  return nextPaymentDate === subscription.nextPaymentDate ? [paymentStatement] : [
    paymentStatement,
    db.prepare(`UPDATE tracker_subscriptions SET next_payment_date = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND next_payment_date = ? AND auto_renew = 1 AND status = 'ACTIVE'`)
      .bind(nextPaymentDate, subscription.id, subscription.nextPaymentDate),
  ];
}

export async function POST(request: Request) {
  const db = trackerDb();
  if (!db) return trackerUnavailable();
  try {
    const input = parseTrackerSubscriptionPaymentInput(await request.json() as Record<string, unknown>);
    if (!input || !input.subscriptionId) return noStoreJson({ error: "Choose a subscription and enter a positive DKK payment with a valid date.", errorCode: "INVALID_SUBSCRIPTION_PAYMENT" }, { status: 400 });
    const subscription = await paymentSubscription(db, input.subscriptionId);
    if (!subscription) return noStoreJson({ error: "The selected subscription no longer exists.", errorCode: "SUBSCRIPTION_NOT_FOUND" }, { status: 404 });
    const created = createTrackerSubscriptionPaymentStatement(db, input);
    await db.batch(paymentStatements(db, subscription, input.occurredAt, created.statement)); const id = created.paymentId;
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
    const input = parseTrackerSubscriptionPaymentInput(payload);
    if (!id || !input || !input.subscriptionId) return noStoreJson({ error: "The subscription payment update contains invalid values.", errorCode: "INVALID_SUBSCRIPTION_PAYMENT" }, { status: 400 });
    const subscription = await paymentSubscription(db, input.subscriptionId);
    if (!subscription) return noStoreJson({ error: "The selected subscription no longer exists.", errorCode: "SUBSCRIPTION_NOT_FOUND" }, { status: 404 });
    const prepared = createTrackerSubscriptionPaymentStatement(db, input);
    const paymentUpdate = db.prepare(`UPDATE tracker_subscription_payments SET subscription_id = ?, amount_ore = ?, entered_amount_ore = ?,
      price_mode = ?, vat_treatment = ?, vat_rate_bps = ?, gross_amount_ore = ?, input_vat_ore = ?, output_vat_ore = ?,
      deductible_vat_ore = ?, supplier_country = ?, transaction_context = ?, occurred_at = ?, notes = ? WHERE id = ?`)
      .bind(input.subscriptionId, prepared.amounts.economicPurchaseCostOre, input.amountOre, input.priceMode, input.vatTreatment, input.vatRateBps,
        prepared.amounts.grossAmountOre,
        input.transactionContext === "PRIVATE" ? null : prepared.amounts.inputVatOre,
        input.transactionContext === "PRIVATE" ? null : prepared.amounts.outputVatOre,
        input.transactionContext === "PRIVATE" ? null : prepared.amounts.deductibleVatOre,
        input.supplierCountry || null,
        input.transactionContext, input.occurredAt, input.notes, id);
    const results = await db.batch(paymentStatements(db, subscription, input.occurredAt, paymentUpdate));
    if (results[0]?.meta.changes !== 1) return noStoreJson({ error: "This payment no longer exists.", errorCode: "SUBSCRIPTION_PAYMENT_NOT_FOUND" }, { status: 404 });
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
