import {
  allocatedShipping, cleanTrackerText, noStoreJson, productId, trackerDate, trackerDb,
  trackerError, trackerInteger, trackerMoneyProduct, trackerUnavailable, transactionId,
} from "../../../../lib/tracker";
import type { TrackerProduct, TrackerTransaction } from "../../../track/types";

const transactionSelect = `t.id, t.product_id AS productId, p.name AS productName, t.type, t.quantity,
  t.unit_price_ore AS unitPriceOre, t.shipping_ore AS shippingOre, t.supplier, t.platform,
  t.fee_ore AS feeOre, t.promoted_fee_ore AS promotedFeeOre, t.other_costs_ore AS otherCostsOre,
  t.cost_basis_ore AS costBasisOre, t.revenue_ore AS revenueOre, t.total_costs_ore AS totalCostsOre,
  t.net_profit_ore AS netProfitOre, t.occurred_at AS occurredAt, t.created_at AS createdAt`;

export async function GET() {
  const db = trackerDb();
  if (!db) return trackerUnavailable();
  try {
    const result = await db.prepare(`SELECT ${transactionSelect} FROM tracker_transactions t
      JOIN tracker_products p ON p.id = t.product_id ORDER BY t.occurred_at DESC, t.created_at DESC`).all<TrackerTransaction>();
    return noStoreJson({ transactions: result.results });
  } catch (error) {
    return trackerError(error, "Unable to load transactions.");
  }
}

export async function POST(request: Request) {
  const db = trackerDb();
  if (!db) return trackerUnavailable();
  try {
    const payload = await request.json() as Record<string, unknown>;
    if (payload.type === "PURCHASE") {
      const name = cleanTrackerText(payload.name, 160, true);
      const supplier = cleanTrackerText(payload.supplier, 120) ?? "";
      const quantity = trackerInteger(payload.quantity, { min: 1, max: 1_000_000 });
      const unitPriceOre = trackerInteger(payload.unitPriceOre);
      const shippingOre = trackerInteger(payload.shippingOre ?? 0);
      const occurredAt = trackerDate(payload.occurredAt);
      if (!name || quantity === null || unitPriceOre === null || shippingOre === null || !occurredAt) {
        return noStoreJson({ error: "Complete the purchase with a product, quantity, valid DKK amounts and date." }, { status: 400 });
      }
      const newProductId = productId();
      const id = transactionId();
      const totalCostsOre = trackerMoneyProduct(unitPriceOre, quantity, shippingOre);
      if (totalCostsOre === null) return noStoreJson({ error: "The total purchase amount is too large to store safely." }, { status: 400 });
      await db.batch([
        db.prepare(`INSERT INTO tracker_products
          (id, name, quantity, remaining_quantity, purchase_price_ore, purchase_shipping_ore, supplier, purchase_date, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'IN_STOCK')`)
          .bind(newProductId, name, quantity, quantity, unitPriceOre, shippingOre, supplier, occurredAt),
        db.prepare(`INSERT INTO tracker_transactions
          (id, product_id, type, quantity, unit_price_ore, shipping_ore, supplier, cost_basis_ore, total_costs_ore, occurred_at)
          VALUES (?, ?, 'PURCHASE', ?, ?, ?, ?, ?, ?, ?)`)
          .bind(id, newProductId, quantity, unitPriceOre, shippingOre, supplier || null, totalCostsOre, totalCostsOre, occurredAt),
      ]);
      const transaction = await db.prepare(`SELECT ${transactionSelect} FROM tracker_transactions t JOIN tracker_products p ON p.id = t.product_id WHERE t.id = ?`).bind(id).first<TrackerTransaction>();
      return noStoreJson({ transaction }, { status: 201 });
    }

    if (payload.type === "SALE") {
      const selectedProductId = cleanTrackerText(payload.productId, 80, true);
      const platform = cleanTrackerText(payload.platform, 80, true);
      const quantity = trackerInteger(payload.quantity, { min: 1, max: 1_000_000 });
      const unitPriceOre = trackerInteger(payload.unitPriceOre, { min: 1 });
      const feeOre = trackerInteger(payload.feeOre ?? 0);
      const promotedFeeOre = trackerInteger(payload.promotedFeeOre ?? 0);
      const shippingOre = trackerInteger(payload.shippingOre ?? 0);
      const otherCostsOre = trackerInteger(payload.otherCostsOre ?? 0);
      const occurredAt = trackerDate(payload.occurredAt);
      if (!selectedProductId || !platform || quantity === null || unitPriceOre === null || feeOre === null ||
          promotedFeeOre === null || shippingOre === null || otherCostsOre === null || !occurredAt) {
        return noStoreJson({ error: "Complete the sale with valid inventory, quantities, DKK amounts, platform and date." }, { status: 400 });
      }
      const product = await db.prepare(`SELECT id, name, quantity, remaining_quantity AS remainingQuantity,
        purchase_price_ore AS purchasePriceOre, purchase_shipping_ore AS purchaseShippingOre,
        expected_sale_price_ore AS expectedSalePriceOre, listing_price_ore AS listingPriceOre,
        supplier, purchase_date AS purchaseDate, status, notes, created_at AS createdAt, updated_at AS updatedAt
        FROM tracker_products WHERE id = ?`).bind(selectedProductId).first<TrackerProduct>();
      if (!product) return noStoreJson({ error: "The selected inventory item no longer exists." }, { status: 404 });
      if (product.remainingQuantity < quantity) return noStoreJson({ error: `Only ${product.remainingQuantity} units remain in inventory.` }, { status: 409 });

      const soldBefore = product.quantity - product.remainingQuantity;
      const costBasisOre = trackerMoneyProduct(product.purchasePriceOre, quantity, allocatedShipping(product.purchaseShippingOre, product.quantity, soldBefore, quantity));
      const revenueOre = trackerMoneyProduct(unitPriceOre, quantity);
      if (costBasisOre === null || revenueOre === null) return noStoreJson({ error: "The sale total is too large to store safely." }, { status: 400 });
      const totalCostsOre = costBasisOre + feeOre + promotedFeeOre + shippingOre + otherCostsOre;
      if (!Number.isSafeInteger(totalCostsOre) || totalCostsOre > 100_000_000_000) return noStoreJson({ error: "The sale costs are too large to store safely." }, { status: 400 });
      const netProfitOre = revenueOre - totalCostsOre;
      const id = transactionId();
      const results = await db.batch([
        db.prepare(`INSERT INTO tracker_transactions
          (id, product_id, type, quantity, unit_price_ore, shipping_ore, platform, fee_ore, promoted_fee_ore,
           other_costs_ore, cost_basis_ore, revenue_ore, total_costs_ore, net_profit_ore, occurred_at)
          SELECT ?, id, 'SALE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM tracker_products
          WHERE id = ? AND remaining_quantity >= ?`)
          .bind(id, quantity, unitPriceOre, shippingOre, platform, feeOre, promotedFeeOre, otherCostsOre,
            costBasisOre, revenueOre, totalCostsOre, netProfitOre, occurredAt, selectedProductId, quantity),
        db.prepare(`UPDATE tracker_products SET remaining_quantity = remaining_quantity - ?,
          status = CASE WHEN remaining_quantity - ? = 0 THEN 'SOLD' ELSE status END,
          updated_at = CURRENT_TIMESTAMP WHERE id = ? AND remaining_quantity >= ?`)
          .bind(quantity, quantity, selectedProductId, quantity),
      ]);
      if (results[0]?.meta.changes !== 1 || results[1]?.meta.changes !== 1) {
        return noStoreJson({ error: "Inventory changed before the sale was saved. Review the remaining quantity and try again." }, { status: 409 });
      }
      const transaction = await db.prepare(`SELECT ${transactionSelect} FROM tracker_transactions t JOIN tracker_products p ON p.id = t.product_id WHERE t.id = ?`).bind(id).first<TrackerTransaction>();
      return noStoreJson({ transaction }, { status: 201 });
    }
    return noStoreJson({ error: "Transaction type must be PURCHASE or SALE." }, { status: 400 });
  } catch (error) {
    return trackerError(error, "Unable to save the transaction.");
  }
}
