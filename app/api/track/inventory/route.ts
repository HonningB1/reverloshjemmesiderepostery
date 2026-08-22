import {
  allocatedShipping, cleanTrackerText, noStoreJson, optionalTrackerMoney, productId,
  trackerDate, trackerDb, trackerError, trackerInteger, trackerMoneyProduct, trackerStatus, trackerUnavailable, transactionId,
} from "../../../../lib/tracker";
import type { TrackerProduct, TrackerStatus } from "../../../track/types";

const productSelect = `id, name, quantity, remaining_quantity AS remainingQuantity,
  purchase_price_ore AS purchasePriceOre, purchase_shipping_ore AS purchaseShippingOre,
  expected_sale_price_ore AS expectedSalePriceOre, listing_price_ore AS listingPriceOre,
  supplier, purchase_date AS purchaseDate, status, notes, created_at AS createdAt, updated_at AS updatedAt`;

type ProductInput = {
  name: string; quantity: number; purchasePriceOre: number; purchaseShippingOre: number;
  expectedSalePriceOre: number | null; listingPriceOre: number | null; supplier: string;
  purchaseDate: string; status: TrackerStatus; notes: string;
};

function parseProductInput(payload: Record<string, unknown>, allowSold = false): ProductInput | null {
  const name = cleanTrackerText(payload.name, 160, true);
  const quantity = trackerInteger(payload.quantity, { min: 1, max: 1_000_000 });
  const purchasePriceOre = trackerInteger(payload.purchasePriceOre);
  const purchaseShippingOre = trackerInteger(payload.purchaseShippingOre ?? 0);
  const expectedSalePriceOre = optionalTrackerMoney(payload.expectedSalePriceOre);
  const listingPriceOre = optionalTrackerMoney(payload.listingPriceOre);
  const supplier = cleanTrackerText(payload.supplier, 120) ?? "";
  const purchaseDate = trackerDate(payload.purchaseDate);
  const status = trackerStatus(payload.status);
  const notes = cleanTrackerText(payload.notes, 2_000) ?? "";
  if (!name || quantity === null || purchasePriceOre === null || purchaseShippingOre === null ||
      expectedSalePriceOre === null && payload.expectedSalePriceOre !== null && payload.expectedSalePriceOre !== undefined && payload.expectedSalePriceOre !== "" ||
      listingPriceOre === null && payload.listingPriceOre !== null && payload.listingPriceOre !== undefined && payload.listingPriceOre !== "" ||
      !purchaseDate || !status || (!allowSold && status === "SOLD")) return null;
  if ((expectedSalePriceOre !== null && trackerMoneyProduct(expectedSalePriceOre, quantity) === null) ||
      (listingPriceOre !== null && trackerMoneyProduct(listingPriceOre, quantity) === null)) return null;
  return { name, quantity, purchasePriceOre, purchaseShippingOre, expectedSalePriceOre, listingPriceOre, supplier, purchaseDate, status, notes };
}

export async function GET() {
  const db = trackerDb();
  if (!db) return trackerUnavailable();
  try {
    const result = await db.prepare(`SELECT ${productSelect} FROM tracker_products ORDER BY updated_at DESC, created_at DESC`).all<TrackerProduct>();
    return noStoreJson({ products: result.results });
  } catch (error) {
    return trackerError(error, "Unable to load inventory.");
  }
}

export async function POST(request: Request) {
  const db = trackerDb();
  if (!db) return trackerUnavailable();
  try {
    const input = parseProductInput(await request.json() as Record<string, unknown>);
    if (!input) return noStoreJson({ error: "Complete the inventory fields with valid quantities, DKK amounts and a purchase date." }, { status: 400 });
    const id = productId();
    const purchaseTransactionId = transactionId();
    const totalPurchaseOre = trackerMoneyProduct(input.purchasePriceOre, input.quantity, input.purchaseShippingOre);
    if (totalPurchaseOre === null) return noStoreJson({ error: "The total purchase amount is too large to store safely." }, { status: 400 });
    await db.batch([
      db.prepare(`INSERT INTO tracker_products
        (id, name, quantity, remaining_quantity, purchase_price_ore, purchase_shipping_ore,
         expected_sale_price_ore, listing_price_ore, supplier, purchase_date, status, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, input.name, input.quantity, input.quantity, input.purchasePriceOre, input.purchaseShippingOre,
          input.expectedSalePriceOre, input.listingPriceOre, input.supplier, input.purchaseDate, input.status, input.notes),
      db.prepare(`INSERT INTO tracker_transactions
        (id, product_id, type, quantity, unit_price_ore, shipping_ore, supplier, cost_basis_ore, total_costs_ore, occurred_at)
        VALUES (?, ?, 'PURCHASE', ?, ?, ?, ?, ?, ?, ?)`)
        .bind(purchaseTransactionId, id, input.quantity, input.purchasePriceOre, input.purchaseShippingOre,
          input.supplier || null, totalPurchaseOre, totalPurchaseOre, input.purchaseDate),
    ]);
    const product = await db.prepare(`SELECT ${productSelect} FROM tracker_products WHERE id = ?`).bind(id).first<TrackerProduct>();
    return noStoreJson({ product }, { status: 201 });
  } catch (error) {
    return trackerError(error, "Unable to add the inventory item.");
  }
}

type SaleForRecalculation = {
  id: string; quantity: number; revenueOre: number; feeOre: number; promotedFeeOre: number;
  shippingOre: number; otherCostsOre: number;
};

type PurchaseVatState = {
  quantity: number;
  unitPriceOre: number;
  shippingOre: number;
  vatTreatment: string | null;
};

export async function PATCH(request: Request) {
  const db = trackerDb();
  if (!db) return trackerUnavailable();
  try {
    const payload = await request.json() as Record<string, unknown>;
    const id = cleanTrackerText(payload.id, 80, true);
    const input = parseProductInput(payload, true);
    if (!id || !input) return noStoreJson({ error: "The inventory update contains invalid values." }, { status: 400 });

    const existing = await db.prepare(`SELECT ${productSelect} FROM tracker_products WHERE id = ?`).bind(id).first<TrackerProduct>();
    if (!existing) return noStoreJson({ error: "This inventory item no longer exists." }, { status: 404 });
    const purchaseVat = await db.prepare(`SELECT quantity, unit_price_ore AS unitPriceOre,
      shipping_ore AS shippingOre, vat_treatment AS vatTreatment
      FROM tracker_transactions WHERE product_id = ? AND type = 'PURCHASE' LIMIT 1`)
      .bind(id).first<PurchaseVatState>();
    if (purchaseVat?.vatTreatment && (purchaseVat.quantity !== input.quantity ||
        purchaseVat.unitPriceOre !== input.purchasePriceOre || purchaseVat.shippingOre !== input.purchaseShippingOre)) {
      return noStoreJson({
        error: "Edit VAT-classified purchase amounts from Transactions so VAT and cost basis are recalculated together.",
        errorCode: "EDIT_PURCHASE_WITH_VAT",
      }, { status: 409 });
    }
    const sales = await db.prepare(`SELECT id, quantity, revenue_ore AS revenueOre, fee_ore AS feeOre,
      promoted_fee_ore AS promotedFeeOre, shipping_ore AS shippingOre, other_costs_ore AS otherCostsOre
      FROM tracker_transactions WHERE product_id = ? AND type = 'SALE'
      ORDER BY occurred_at ASC, created_at ASC`).bind(id).all<SaleForRecalculation>();
    const soldQuantity = sales.results.reduce((sum, sale) => sum + Number(sale.quantity), 0);
    if (input.quantity < soldQuantity) return noStoreJson({ error: `Quantity cannot be lower than the ${soldQuantity} units already sold.` }, { status: 409 });
    const remainingQuantity = input.quantity - soldQuantity;
    const finalStatus: TrackerStatus = remainingQuantity === 0 ? "SOLD" : input.status === "SOLD" ? "IN_STOCK" : input.status;
    const purchaseTotal = trackerMoneyProduct(input.purchasePriceOre, input.quantity, input.purchaseShippingOre);
    if (purchaseTotal === null) return noStoreJson({ error: "The total purchase amount is too large to store safely." }, { status: 400 });
    const statements = [
      db.prepare(`UPDATE tracker_products SET name = ?, quantity = ?, remaining_quantity = ?, purchase_price_ore = ?,
        purchase_shipping_ore = ?, expected_sale_price_ore = ?, listing_price_ore = ?, supplier = ?, purchase_date = ?,
        status = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .bind(input.name, input.quantity, remainingQuantity, input.purchasePriceOre, input.purchaseShippingOre,
          input.expectedSalePriceOre, input.listingPriceOre, input.supplier, input.purchaseDate, finalStatus, input.notes, id),
      db.prepare(`UPDATE tracker_transactions SET quantity = ?, unit_price_ore = ?, shipping_ore = ?, supplier = ?,
        cost_basis_ore = ?, total_costs_ore = ?, occurred_at = ? WHERE product_id = ? AND type = 'PURCHASE'`)
        .bind(input.quantity, input.purchasePriceOre, input.purchaseShippingOre, input.supplier || null,
          purchaseTotal, purchaseTotal, input.purchaseDate, id),
    ];
    let cumulativeSold = 0;
    for (const sale of sales.results) {
      const costBasisOre = input.purchasePriceOre * sale.quantity + allocatedShipping(input.purchaseShippingOre, input.quantity, cumulativeSold, sale.quantity);
      const totalCostsOre = costBasisOre + sale.feeOre + sale.promotedFeeOre + sale.shippingOre + sale.otherCostsOre;
      if (![costBasisOre, totalCostsOre].every((value) => Number.isSafeInteger(value) && value >= 0)) return noStoreJson({ error: "The recalculated transaction total is too large to store safely." }, { status: 400 });
      statements.push(db.prepare("UPDATE tracker_transactions SET cost_basis_ore = ?, total_costs_ore = ?, net_profit_ore = ? WHERE id = ?")
        .bind(costBasisOre, totalCostsOre, sale.revenueOre - totalCostsOre, sale.id));
      cumulativeSold += sale.quantity;
    }
    await db.batch(statements);
    const product = await db.prepare(`SELECT ${productSelect} FROM tracker_products WHERE id = ?`).bind(id).first<TrackerProduct>();
    return noStoreJson({ product });
  } catch (error) {
    return trackerError(error, "Unable to update the inventory item.");
  }
}

export async function DELETE(request: Request) {
  const db = trackerDb();
  if (!db) return trackerUnavailable();
  try {
    const payload = await request.json() as { id?: unknown };
    const id = cleanTrackerText(payload.id, 80, true);
    if (!id) return noStoreJson({ error: "Invalid inventory item." }, { status: 400 });
    const results = await db.batch([
      db.prepare("DELETE FROM tracker_transactions WHERE product_id = ?").bind(id),
      db.prepare("DELETE FROM tracker_products WHERE id = ?").bind(id),
    ]);
    if (results[1]?.meta.changes !== 1) return noStoreJson({ error: "This inventory item no longer exists." }, { status: 404 });
    return noStoreJson({ id, deleted: true });
  } catch (error) {
    return trackerError(error, "Unable to delete the inventory item.");
  }
}
