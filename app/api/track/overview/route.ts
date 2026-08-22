import { noStoreJson, trackerDb, trackerError, trackerUnavailable } from "../../../../lib/tracker";
import { remainingOperationalInventoryCost } from "../../../../lib/tracker-accounting";
import { operationalSalesById, type OperationalSale } from "../../../../lib/tracker-operational";
import { effectiveTransactionContextSql } from "../../../../lib/tracker-context";
import type { ProfitPoint, TrackerActivity, TrackerProduct, TrackerStatus } from "../../../track/types";

type CashInvestedRow = { cashInvestedOre: number };
type OperatingRow = { date: string; amountOre: number };
type StatusRow = { status: TrackerStatus; count: number };
type SaleRow = OperationalSale & { grossRevenueOre: number | null; transactionContext: "PRIVATE" | "B2B" | "SPECIAL" | null };

const productSelect = `id, name, quantity, remaining_quantity AS remainingQuantity,
  purchase_price_ore AS purchasePriceOre, purchase_shipping_ore AS purchaseShippingOre,
  COALESCE((SELECT CASE WHEN ${effectiveTransactionContextSql("purchase.transaction_context", "purchase.is_b2b")} = 'PRIVATE' THEN COALESCE(purchase.entered_unit_price_ore, purchase.unit_price_ore) END
    FROM tracker_transactions purchase WHERE purchase.product_id = tracker_products.id AND purchase.type = 'PURCHASE' LIMIT 1), purchase_price_ore) AS operationalPurchasePriceOre,
  COALESCE((SELECT CASE WHEN ${effectiveTransactionContextSql("purchase.transaction_context", "purchase.is_b2b")} = 'PRIVATE' THEN COALESCE(purchase.entered_shipping_ore, purchase.shipping_ore) END
    FROM tracker_transactions purchase WHERE purchase.product_id = tracker_products.id AND purchase.type = 'PURCHASE' LIMIT 1), purchase_shipping_ore) AS operationalPurchaseShippingOre,
  expected_sale_price_ore AS expectedSalePriceOre, listing_price_ore AS listingPriceOre,
  supplier, purchase_date AS purchaseDate, status, notes, created_at AS createdAt, updated_at AS updatedAt`;

// Cloudflare Access must protect /api/track/*; the app deliberately has no login layer.
export async function GET() {
  const db = trackerDb();
  if (!db) return trackerUnavailable();
  try {
    const [products, sales, cashInvested, operatingRows, recentActivity, inventorySnapshot, statusRows] = await Promise.all([
      db.prepare(`SELECT ${productSelect} FROM tracker_products`).all<TrackerProduct>(),
      db.prepare(`SELECT id, product_id AS productId, quantity, revenue_ore AS revenueOre, fee_ore AS feeOre,
        promoted_fee_ore AS promotedFeeOre, shipping_ore AS shippingOre, other_costs_ore AS otherCostsOre,
        gross_amount_ore AS grossRevenueOre, ${effectiveTransactionContextSql("transaction_context", "is_b2b")} AS transactionContext, occurred_at AS occurredAt,
        created_at AS createdAt FROM tracker_transactions WHERE type = 'SALE'`).all<SaleRow>(),
      db.prepare(`SELECT
        COALESCE(SUM(CASE WHEN type = 'PURCHASE' THEN COALESCE(gross_amount_ore, total_costs_ore) ELSE 0 END), 0) AS cashInvestedOre
        FROM tracker_transactions`).first<CashInvestedRow>(),
      db.prepare(`SELECT occurred_at AS date, amount_ore AS amountOre FROM tracker_expenses
        UNION ALL SELECT occurred_at AS date,
          CASE WHEN ${effectiveTransactionContextSql("transaction_context")} = 'PRIVATE' THEN COALESCE(entered_amount_ore, gross_amount_ore, amount_ore) ELSE amount_ore END
          AS amountOre FROM tracker_subscription_payments`).all<OperatingRow>(),
      db.prepare(`SELECT id, kind, title, quantity, context, amountOre, occurredAt FROM (
        SELECT t.id, t.type AS kind, p.name AS title,
          t.quantity,
          CASE WHEN t.type = 'SALE' THEN COALESCE(t.platform, '') ELSE COALESCE(t.supplier, '') END AS context,
          CASE WHEN t.type = 'SALE' THEN t.revenue_ore ELSE t.total_costs_ore END AS amountOre,
          t.occurred_at AS occurredAt, t.created_at AS createdAt
        FROM tracker_transactions t JOIN tracker_products p ON p.id = t.product_id
        UNION ALL
        SELECT id, 'EXPENSE', name, NULL, category, amount_ore, occurred_at, created_at FROM tracker_expenses
        UNION ALL
        SELECT p.id, 'SUBSCRIPTION_PAYMENT', s.name, NULL, '', p.amount_ore,
          p.occurred_at, p.created_at FROM tracker_subscription_payments p
          JOIN tracker_subscriptions s ON s.id = p.subscription_id
      ) ORDER BY occurredAt DESC, createdAt DESC LIMIT 7`).all<TrackerActivity>(),
      db.prepare(`SELECT ${productSelect} FROM tracker_products
        WHERE remaining_quantity > 0 ORDER BY updated_at DESC LIMIT 6`).all<TrackerProduct>(),
      db.prepare("SELECT status, COUNT(*) AS count FROM tracker_products GROUP BY status").all<StatusRow>(),
    ]);

    const operational = operationalSalesById(products.results, sales.results);
    const daily = new Map<string, ProfitPoint>();
    const point = (date: string) => {
      const existing = daily.get(date) ?? { date, tradingProfitOre: 0, operatingExpensesOre: 0, netProfitOre: 0, revenueOre: 0, tradingCostsOre: 0 };
      daily.set(date, existing); return existing;
    };
    for (const sale of sales.results) {
      const result = operational.get(sale.id); if (!result) continue;
      const current = point(sale.occurredAt); current.tradingProfitOre += result.operationalProfitOre;
      current.revenueOre += result.operationalRevenueOre; current.tradingCostsOre += result.operationalTotalCostsOre;
    }
    for (const expense of operatingRows.results) point(expense.date).operatingExpensesOre += Number(expense.amountOre);
    const profitSeries = [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)).map((entry) => ({ ...entry,
      netProfitOre: entry.tradingProfitOre - entry.operatingExpensesOre }));
    const tradingProfitOre = [...operational.values()].reduce((sum, sale) => sum + sale.operationalProfitOre, 0);
    const revenueOre = [...operational.values()].reduce((sum, sale) => sum + sale.operationalRevenueOre, 0);
    const operatingExpensesOre = operatingRows.results.reduce((sum, row) => sum + Number(row.amountOre), 0);
    const inventoryValueOre = products.results.reduce((sum, product) => sum + remainingOperationalInventoryCost(product), 0);
    const statusCounts: Record<TrackerStatus, number> = { IN_STOCK: 0, LISTED: 0, RESERVED: 0, SOLD: 0 };
    for (const row of statusRows.results) statusCounts[row.status] = Number(row.count);
    const hydratedActivity = recentActivity.results.map((entry) => entry.kind === "SALE" && operational.has(entry.id)
      ? { ...entry, amountOre: operational.get(entry.id)!.operationalRevenueOre } : entry);

    return noStoreJson({
      metrics: {
        tradingProfitOre,
        operatingExpensesOre,
        netProfitOre: tradingProfitOre - operatingExpensesOre,
        revenueOre,
        inventoryValueOre,
        cashInvestedOre: Number(cashInvested?.cashInvestedOre ?? 0),
      },
      profitSeries,
      recentActivity: hydratedActivity,
      inventorySnapshot: inventorySnapshot.results,
      statusCounts,
    });
  } catch (error) {
    return trackerError(error, "Unable to load the tracker overview.");
  }
}
