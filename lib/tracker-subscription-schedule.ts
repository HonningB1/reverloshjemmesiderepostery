export type SubscriptionBillingPeriod = "WEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY" | "CUSTOM";
export type SubscriptionRenewalSchedule = {
  billingPeriod: SubscriptionBillingPeriod;
  nextPaymentDate: string;
  autoRenew: boolean;
  status: "ACTIVE" | "ARCHIVED";
};

function calendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
}

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function daysInUtcMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function advanceSubscriptionDate(value: Date, period: SubscriptionBillingPeriod, anchorDay: number) {
  const next = new Date(value.getTime());
  if (period === "WEEKLY") {
    next.setUTCDate(next.getUTCDate() + 7);
    return next;
  }
  const months = period === "MONTHLY" ? 1 : period === "QUARTERLY" ? 3 : period === "YEARLY" ? 12 : 0;
  if (!months) return null;
  const targetMonth = next.getUTCMonth() + months;
  next.setUTCDate(1);
  next.setUTCMonth(targetMonth);
  next.setUTCDate(Math.min(anchorDay, daysInUtcMonth(next.getUTCFullYear(), next.getUTCMonth())));
  return next;
}

/** A confirmed payment advances its active renewal plan; it never creates a payment itself. */
export function nextSubscriptionPaymentDateAfterRecordedPayment(schedule: SubscriptionRenewalSchedule, occurredAt: string) {
  if (schedule.status !== "ACTIVE" || !schedule.autoRenew || schedule.billingPeriod === "CUSTOM") return schedule.nextPaymentDate;
  const due = calendarDate(schedule.nextPaymentDate); const paidAt = calendarDate(occurredAt);
  if (!due || !paidAt || paidAt < due) return schedule.nextPaymentDate;
  const anchorDay = due.getUTCDate(); let next = due;
  for (let guard = 0; next <= paidAt && guard < 600; guard += 1) {
    const advanced = advanceSubscriptionDate(next, schedule.billingPeriod, anchorDay);
    if (!advanced) return schedule.nextPaymentDate;
    next = advanced;
  }
  return next > paidAt ? isoDate(next) : schedule.nextPaymentDate;
}
