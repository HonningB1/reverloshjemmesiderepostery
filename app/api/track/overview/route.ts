import { noStoreJson, trackerDb, trackerError, trackerUnavailable } from "../../../../lib/tracker";
import type { ProfitPoint, TrackerActivity, TrackerProduct, TrackerStatus } from "../../../track/types";

type MetricsRow = { tradingProfitOre: number; revenueOre: number; cashInvestedOre: number };
type OperatingRow = { operatingExpensesOre: number };
type InventoryValueRow = { inventoryValueOre: number };
type StatusRow = { status: TrackerStatus; count: number };

const productSelect = `id, name, quantity, remaining_quantity AS remainingQuantity,
  purchase_price_ore AS purchasePriceOre, purchase_shipping_ore AS purchaseShippingOre,
  expected_sale_price_ore AS expectedSalePriceOre, listing_price_ore AS listingPriceOre,
  supplier, purchase_date AS purchaseDate, status, notes, created_at AS createdAt, updated_at AS updatedAt`;

// Cloudflare Access must protect /api/track/*; the app deliberately has no login layer.
export async function GET() {
  const db = trackerDb();
  if (!db) return trackerUnavailable();
  try {
    const [metrics, operating, inventoryValue, profitSeries, recentActivity, inventorySnapshot, statusRows] = await Promise.all([
      db.prepare(`SELECT
        COALESCE(SUM(CASE WHEN type = 'SALE' THEN net_profit_ore ELSE 0 END), 0) AS tradingProfitOre,
        COALESCE(SUM(CASE WHEN type = 'SALE' THEN revenue_ore ELSE 0 END), 0) AS revenueOre,
        COALESCE(SUM(CASE WHEN type = 'PURCHASE' THEN COALESCE(gross_amount_ore, total_costs_ore) ELSE 0 END), 0) AS cashInvestedOre
        FROM tracker_transactions`).first<MetricsRow>(),
      db.prepare(`SELECT
        (SELECT COALESCE(SUM(amount_ore), 0) FROM tracker_expenses) +
        (SELECT COALESCE(SUM(amount_ore), 0) FROM tracker_subscription_payments) AS operatingExpensesOre`).first<OperatingRow>(),
      db.prepare(`SELECT COALESCE(SUM(
        purchase_price_ore * remaining_quantity +
        CAST(purchase_shipping_ore * remaining_quantity / quantity AS INTEGER)
      ), 0) AS inventoryValueOre FROM tracker_products`).first<InventoryValueRow>(),
      db.prepare(`WITH daily AS (
        SELECT occurred_at AS date, SUM(net_profit_ore) AS tradingProfitOre, 0 AS operatingExpensesOre,
          SUM(revenue_ore) AS revenueOre, SUM(total_costs_ore) AS tradingCostsOre
        FROM tracker_transactions WHERE type = 'SALE' GROUP BY occurred_at
        UNION ALL
        SELECT occurred_at AS date, 0, SUM(amount_ore), 0, 0 FROM tracker_expenses GROUP BY occurred_at
        UNION ALL
        SELECT occurred_at AS date, 0, SUM(amount_ore), 0, 0 FROM tracker_subscription_payments GROUP BY occurred_at
      ) SELECT date, SUM(tradingProfitOre) AS tradingProfitOre,
        SUM(operatingExpensesOre) AS operatingExpensesOre,
        SUM(tradingProfitOre) - SUM(operatingExpensesOre) AS netProfitOre,
        SUM(revenueOre) AS revenueOre, SUM(tradingCostsOre) AS tradingCostsOre
        FROM daily GROUP BY date ORDER BY date ASC`).all<ProfitPoint>(),
      db.prepare(`SELECT id, kind, title, detail, amountOre, occurredAt FROM (
        SELECT t.id, t.type AS kind, p.name AS title,
          CASE WHEN t.type = 'SALE' THEN COALESCE(t.platform, 'Sale') || ' · ' || t.quantity || ' sold'
               ELSE COALESCE(t.supplier, 'Purchase') || ' · ' || t.quantity || ' bought' END AS detail,
          CASE WHEN t.type = 'SALE' THEN t.revenue_ore ELSE t.total_costs_ore END AS amountOre,
          t.occurred_at AS occurredAt, t.created_at AS createdAt
        FROM tracker_transactions t JOIN tracker_products p ON p.id = t.product_id
        UNION ALL
        SELECT id, 'EXPENSE', name, category, amount_ore, occurred_at, created_at FROM tracker_expenses
        UNION ALL
        SELECT p.id, 'SUBSCRIPTION_PAYMENT', s.name, 'Subscription payment', p.amount_ore,
          p.occurred_at, p.created_at FROM tracker_subscription_payments p
          JOIN tracker_subscriptions s ON s.id = p.subscription_id
      ) ORDER BY occurredAt DESC, createdAt DESC LIMIT 7`).all<TrackerActivity>(),
      db.prepare(`SELECT ${productSelect} FROM tracker_products
        WHERE remaining_quantity > 0 ORDER BY updated_at DESC LIMIT 6`).all<TrackerProduct>(),
      db.prepare("SELECT status, COUNT(*) AS count FROM tracker_products GROUP BY status").all<StatusRow>(),
    ]);

    const statusCounts: Record<TrackerStatus, number> = { IN_STOCK: 0, LISTED: 0, RESERVED: 0, SOLD: 0 };
    for (const row of statusRows.results) statusCounts[row.status] = Number(row.count);
    const tradingProfitOre = Number(metrics?.tradingProfitOre ?? 0);
    const operatingExpensesOre = Number(operating?.operatingExpensesOre ?? 0);

    return noStoreJson({
      metrics: {
        tradingProfitOre,
        operatingExpensesOre,
        netProfitOre: tradingProfitOre - operatingExpensesOre,
        revenueOre: Number(metrics?.revenueOre ?? 0),
        inventoryValueOre: Number(inventoryValue?.inventoryValueOre ?? 0),
        cashInvestedOre: Number(metrics?.cashInvestedOre ?? 0),
      },
      profitSeries: profitSeries.results,
      recentActivity: recentActivity.results,
      inventorySnapshot: inventorySnapshot.results,
      statusCounts,
    });
  } catch (error) {
    return trackerError(error, "Unable to load the tracker overview.");
  }
}
