import { calculatePrivateAmounts, calendarDateInTimeZone } from "./tracker-accounting.ts";
import { nextSubscriptionPaymentDateAfterRecordedPayment, type SubscriptionBillingPeriod } from "./tracker-subscription-schedule.ts";

type DueSubscription = {
  id: string;
  costOre: number;
  billingPeriod: SubscriptionBillingPeriod;
  nextPaymentDate: string;
  autoRenew: number;
  status: "ACTIVE" | "ARCHIVED";
};

export type SubscriptionRenewalResult = {
  dueSubscriptions: number;
  paymentsCreated: number;
  schedulesAdvanced: number;
};

export function automaticSubscriptionPaymentId(subscriptionId: string, dueDate: string) {
  return `subpay_auto_${subscriptionId}_${dueDate}`;
}

function renewalStatements(db: D1Database, subscription: DueSubscription) {
  const nextPaymentDate = nextSubscriptionPaymentDateAfterRecordedPayment({
    billingPeriod: subscription.billingPeriod, nextPaymentDate: subscription.nextPaymentDate,
    autoRenew: Boolean(subscription.autoRenew), status: subscription.status,
  }, subscription.nextPaymentDate);
  if (nextPaymentDate === subscription.nextPaymentDate) return [];
  const amount = calculatePrivateAmounts({
    type: "PURCHASE", quantity: 1, enteredUnitPriceOre: subscription.costOre, enteredShippingOre: 0,
  });
  const paymentId = automaticSubscriptionPaymentId(subscription.id, subscription.nextPaymentDate);
  return [
    // A payment already recorded manually on the renewal date is authoritative.
    // The deterministic primary key also makes overlapping cron runs idempotent.
    db.prepare(`INSERT OR IGNORE INTO tracker_subscription_payments
      (id, subscription_id, amount_ore, entered_amount_ore, price_mode, vat_treatment, vat_rate_bps, gross_amount_ore,
       input_vat_ore, output_vat_ore, deductible_vat_ore, supplier_country, transaction_context, occurred_at, notes)
      SELECT ?, ?, ?, ?, NULL, NULL, NULL, ?, NULL, NULL, NULL, NULL, 'PRIVATE', ?, 'Automatic renewal'
      WHERE NOT EXISTS (SELECT 1 FROM tracker_subscription_payments WHERE subscription_id = ? AND occurred_at = ?)`)
      .bind(paymentId, subscription.id, amount.economicPurchaseCostOre, subscription.costOre, amount.grossAmountOre,
        subscription.nextPaymentDate, subscription.id, subscription.nextPaymentDate),
    db.prepare(`UPDATE tracker_subscriptions SET next_payment_date = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND next_payment_date = ? AND auto_renew = 1 AND status = 'ACTIVE'
        AND EXISTS (SELECT 1 FROM tracker_subscription_payments WHERE subscription_id = ? AND occurred_at = ?)`)
      .bind(nextPaymentDate, subscription.id, subscription.nextPaymentDate, subscription.id, subscription.nextPaymentDate),
  ];
}

/**
 * Runs from the existing Cloudflare cron. It creates one real cash expense per
 * due cycle for active auto-renewing subscriptions and advances the plan only
 * after that payment exists. CUSTOM schedules remain explicitly user-managed.
 */
export async function syncTrackerSubscriptionRenewals(db: D1Database, now = new Date()): Promise<SubscriptionRenewalResult> {
  const today = calendarDateInTimeZone(now);
  const due = await db.prepare(`SELECT id, cost_ore AS costOre, billing_period AS billingPeriod,
    next_payment_date AS nextPaymentDate, auto_renew AS autoRenew, status
    FROM tracker_subscriptions
    WHERE status = 'ACTIVE' AND auto_renew = 1 AND billing_period <> 'CUSTOM' AND next_payment_date <= ?
    ORDER BY next_payment_date ASC LIMIT 100`).bind(today).all<DueSubscription>();
  let paymentsCreated = 0; let schedulesAdvanced = 0;
  for (const subscription of due.results) {
    const statements = renewalStatements(db, subscription);
    if (!statements.length) continue;
    const results = await db.batch(statements);
    paymentsCreated += Number(results[0]?.meta.changes ?? 0);
    schedulesAdvanced += Number(results[1]?.meta.changes ?? 0);
  }
  return { dueSubscriptions: due.results.length, paymentsCreated, schedulesAdvanced };
}
