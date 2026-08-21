import { noStoreJson, trackerDb, trackerError, trackerUnavailable } from "../../../../lib/tracker";
import type { TrackerProduct, TrackerStatus, TrackerTransaction } from "../../../track/types";

type MetricsRow = { totalProfitOre: number; revenueOre: number; cashInvestedOre: number };
type InventoryValueRow = { inventoryValueOre: number };
type StatusRow = { status: TrackerStatus; count: number };
type ProfitRow = { date: string; profitOre: number; revenueOre: number; costsOre: number };

const productSelect = `id, name, quantity, remaining_quantity AS remainingQuantity,
  purchase_price_ore AS purchasePriceOre, purchase_shipping_ore AS purchaseShippingOre,
  expected_sale_price_ore AS expectedSalePriceOre, listing_price_ore AS listingPriceOre,
  supplier, purchase_date AS purchaseDate, status, notes, created_at AS createdAt, updated_at AS updatedAt`;

const transactionSelect = `t.id, t.product_id AS productId, p.name AS productName, t.type, t.quantity,
  t.unit_price_ore AS unitPriceOre, t.shipping_ore AS shippingOre, t.supplier, t.platform,
  t.fee_ore AS feeOre, t.promoted_fee_ore AS promotedFeeOre, t.other_costs_ore AS otherCostsOre,
  t.cost_basis_ore AS costBasisOre, t.revenue_ore AS revenueOre, t.total_costs_ore AS totalCostsOre,
  t.net_profit_ore AS netProfitOre, t.occurred_at AS occurredAt, t.created_at AS createdAt`;

// Cloudflare Access must protect /api/track/*; the app deliberately has no login layer.
export async function GET() {
  const db = trackerDb();
  if (!db) return trackerUnavailable();
  try {
    const [metrics, inventoryValue, profitSeries, recentActivity, inventorySnapshot, statusRows] = await Promise.all([
      db.prepare(`SELECT
        COALESCE(SUM(CASE WHEN type = 'SALE' THEN net_profit_ore ELSE 0 END), 0) AS totalProfitOre,
        COALESCE(SUM(CASE WHEN type = 'SALE' THEN revenue_ore ELSE 0 END), 0) AS revenueOre,
        COALESCE(SUM(CASE WHEN type = 'PURCHASE' THEN total_costs_ore ELSE 0 END), 0) AS cashInvestedOre
        FROM tracker_transactions`).first<MetricsRow>(),
      db.prepare(`SELECT COALESCE(SUM(
        purchase_price_ore * remaining_quantity +
        CAST(purchase_shipping_ore * remaining_quantity / quantity AS INTEGER)
      ), 0) AS inventoryValueOre FROM tracker_products`).first<InventoryValueRow>(),
      db.prepare(`SELECT occurred_at AS date, SUM(net_profit_ore) AS profitOre,
        SUM(revenue_ore) AS revenueOre, SUM(total_costs_ore) AS costsOre
        FROM tracker_transactions WHERE type = 'SALE'
        GROUP BY occurred_at ORDER BY occurred_at ASC`).all<ProfitRow>(),
      db.prepare(`SELECT ${transactionSelect} FROM tracker_transactions t
        JOIN tracker_products p ON p.id = t.product_id
        ORDER BY t.occurred_at DESC, t.created_at DESC LIMIT 7`).all<TrackerTransaction>(),
      db.prepare(`SELECT ${productSelect} FROM tracker_products
        WHERE remaining_quantity > 0 ORDER BY updated_at DESC LIMIT 6`).all<TrackerProduct>(),
      db.prepare("SELECT status, COUNT(*) AS count FROM tracker_products GROUP BY status").all<StatusRow>(),
    ]);

    const statusCounts: Record<TrackerStatus, number> = { IN_STOCK: 0, LISTED: 0, RESERVED: 0, SOLD: 0 };
    for (const row of statusRows.results) statusCounts[row.status] = Number(row.count);

    return noStoreJson({
      metrics: {
        totalProfitOre: Number(metrics?.totalProfitOre ?? 0),
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
