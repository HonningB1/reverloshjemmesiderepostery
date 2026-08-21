import { env } from "cloudflare:workers";
import { trackerStatuses, type TrackerStatus } from "../app/track/types";

const MAX_MONEY_ORE = 100_000_000_000;

export function trackerDb() {
  return env.DB ?? null;
}

export function trackerUnavailable() {
  return Response.json({ error: "Tracker storage is not initialized yet. Apply the private tracker D1 migration first." }, { status: 503 });
}

export function trackerError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("no such table") || message.includes("tracker_products") || message.includes("tracker_transactions") ||
      message.includes("tracker_expenses") || message.includes("tracker_subscriptions") || message.includes("tracker_subscription_payments")) return trackerUnavailable();
  console.error("Reverlo tracker request failed", { message: message.slice(0, 300) });
  return Response.json({ error: fallback }, { status: 500 });
}

export function noStoreJson(value: unknown, init?: ResponseInit) {
  const response = Response.json(value, init);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

export function cleanTrackerText(value: unknown, maxLength: number, required = false) {
  const result = typeof value === "string" ? value.trim().slice(0, maxLength) : "";
  return required && !result ? null : result;
}

export function trackerInteger(value: unknown, { min = 0, max = MAX_MONEY_ORE }: { min?: number; max?: number } = {}) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

export function trackerMoneyProduct(unitPriceOre: number, quantity: number, ...extras: number[]) {
  const total = unitPriceOre * quantity + extras.reduce((sum, value) => sum + value, 0);
  return Number.isSafeInteger(total) && total >= 0 && total <= MAX_MONEY_ORE ? total : null;
}

export function optionalTrackerMoney(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  return trackerInteger(value);
}

export function trackerDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : value;
}

export function trackerStatus(value: unknown): TrackerStatus | null {
  return typeof value === "string" && trackerStatuses.includes(value as TrackerStatus) ? value as TrackerStatus : null;
}

export function productId() {
  return `prd_${crypto.randomUUID()}`;
}

export function transactionId() {
  return `txn_${crypto.randomUUID()}`;
}

export function expenseId() {
  return `exp_${crypto.randomUUID()}`;
}

export function subscriptionId() {
  return `sub_${crypto.randomUUID()}`;
}

export function subscriptionPaymentId() {
  return `subpay_${crypto.randomUUID()}`;
}

export function allocatedShipping(totalShippingOre: number, totalQuantity: number, soldBefore: number, soldQuantity: number) {
  const shipping = BigInt(totalShippingOre);
  const quantity = BigInt(totalQuantity);
  const before = (shipping * BigInt(soldBefore)) / quantity;
  const after = (shipping * BigInt(soldBefore + soldQuantity)) / quantity;
  return Number(after - before);
}
