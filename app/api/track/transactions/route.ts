import { calculateVatAmounts, recalculateProductSales, type SaleLedgerInput } from "../../../../lib/tracker-accounting";
import {
  noStoreJson, optionalTrackerMoney, productId, strictTrackerText, trackerBoolean, trackerDate, trackerDb,
  trackerError, trackerInteger, trackerPriceMode, trackerUnavailable, trackerVatTreatment, transactionId,
} from "../../../../lib/tracker";
import type { TrackerProduct, TrackerStatus, TrackerTransaction, TransactionType } from "../../../track/types";

const transactionSelect = `t.id, t.product_id AS productId, p.name AS productName, t.type, t.quantity,
  t.unit_price_ore AS unitPriceOre, t.shipping_ore AS shippingOre, t.supplier, t.platform,
  t.fee_ore AS feeOre, t.promoted_fee_ore AS promotedFeeOre, t.other_costs_ore AS otherCostsOre,
  t.cost_basis_ore AS costBasisOre, t.revenue_ore AS revenueOre, t.total_costs_ore AS totalCostsOre,
  t.net_profit_ore AS netProfitOre, t.notes, t.price_mode AS priceMode, t.vat_treatment AS vatTreatment,
  t.entered_unit_price_ore AS enteredUnitPriceOre, t.entered_shipping_ore AS enteredShippingOre,
  t.entered_total_price_ore AS enteredTotalPriceOre,
  t.vat_rate_bps AS vatRateBps, t.gross_amount_ore AS grossAmountOre, t.input_vat_ore AS inputVatOre,
  t.output_vat_ore AS outputVatOre, t.deductible_vat_ore AS deductibleVatOre,
  t.supplier_country AS supplierCountry, t.customer_country AS customerCountry,
  t.is_b2b AS isB2b, t.vat_id_reference AS vatIdReference,
  t.occurred_at AS occurredAt, t.created_at AS createdAt, t.updated_at AS updatedAt`;

const productSelect = `id, name, quantity, remaining_quantity AS remainingQuantity,
  purchase_price_ore AS purchasePriceOre, purchase_shipping_ore AS purchaseShippingOre,
  expected_sale_price_ore AS expectedSalePriceOre, listing_price_ore AS listingPriceOre,
  supplier, purchase_date AS purchaseDate, status, notes, created_at AS createdAt, updated_at AS updatedAt`;

type ProductRow = TrackerProduct;
type SaleRow = SaleLedgerInput & { productId: string };

function country(value: unknown) {
  if (value === null || value === undefined || value === "") return "";
  const parsed = strictTrackerText(value, 2);
  return parsed && /^[A-Za-z]{2}$/.test(parsed) ? parsed.toUpperCase() : null;
}

function parseOptionalMoney(value: unknown) {
  const parsed = optionalTrackerMoney(value);
  if (parsed === null && value !== null && value !== undefined && value !== "") return undefined;
  return parsed;
}

function parseAccounting(payload: Record<string, unknown>, type: TransactionType, quantity: number, unitPriceOre: number, shippingOre: number) {
  const priceMode = trackerPriceMode(payload.priceMode ?? "VAT_EXCLUSIVE");
  const vatTreatment = trackerVatTreatment(payload.vatTreatment);
  const vatRateBps = trackerInteger(payload.vatRateBps ?? 0, { max: 10_000 });
  const manualInputVatOre = parseOptionalMoney(payload.inputVatOre);
  const manualOutputVatOre = parseOptionalMoney(payload.outputVatOre);
  const manualDeductibleVatOre = parseOptionalMoney(payload.deductibleVatOre);
  const enteredTotalPriceOre = parseOptionalMoney(payload.totalPriceOre);
  if (!priceMode || !vatTreatment || vatRateBps === null || manualInputVatOre === undefined ||
      manualOutputVatOre === undefined || manualDeductibleVatOre === undefined || enteredTotalPriceOre === undefined) return null;
  try {
    return {
      priceMode, vatTreatment, vatRateBps,
      amounts: calculateVatAmounts({
        type, quantity, enteredUnitPriceOre: unitPriceOre, enteredShippingOre: shippingOre,
        priceMode, vatTreatment, vatRateBps, enteredTotalPriceOre,
        manualInputVatOre, manualOutputVatOre, manualDeductibleVatOre,
      }),
    };
  } catch {
    return null;
  }
}

function statusForRemaining(status: TrackerStatus, remaining: number): TrackerStatus {
  if (remaining === 0) return "SOLD";
  return status === "SOLD" ? "IN_STOCK" : status;
}

async function loadProduct(db: D1Database, id: string) {
  return db.prepare(`SELECT ${productSelect} FROM tracker_products WHERE id = ?`).bind(id).first<ProductRow>();
}

async function loadSales(db: D1Database, productIdValue: string) {
  return (await db.prepare(`SELECT id, product_id AS productId, quantity, revenue_ore AS revenueOre,
    fee_ore AS feeOre, promoted_fee_ore AS promotedFeeOre, shipping_ore AS shippingOre,
    other_costs_ore AS otherCostsOre, occurred_at AS occurredAt, created_at AS createdAt
    FROM tracker_transactions WHERE product_id = ? AND type = 'SALE'
    ORDER BY occurred_at ASC, created_at ASC, id ASC`).bind(productIdValue).all<SaleRow>()).results;
}

function saleRecalculationStatements(db: D1Database, rows: ReturnType<typeof recalculateProductSales>["sales"]) {
  return rows.map((sale) => db.prepare(`UPDATE tracker_transactions SET cost_basis_ore = ?, total_costs_ore = ?,
    net_profit_ore = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .bind(sale.costBasisOre, sale.totalCostsOre, sale.netProfitOre, sale.id));
}

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
    const occurredAt = trackerDate(payload.occurredAt);
    const quantity = trackerInteger(payload.quantity, { min: 1, max: 1_000_000 });
    const enteredUnitPriceOre = trackerInteger(payload.unitPriceOre, { min: payload.type === "SALE" ? 1 : 0 });
    const shippingOre = trackerInteger(payload.shippingOre ?? 0);
    const notes = strictTrackerText(payload.notes ?? "", 2_000);
    if (!occurredAt || quantity === null || enteredUnitPriceOre === null || shippingOre === null || notes === null) {
      return noStoreJson({ error: "Complete the transaction with a quantity, valid DKK amounts and date.", errorCode: "INVALID_TRANSACTION" }, { status: 400 });
    }

    if (payload.type === "PURCHASE") {
      const name = strictTrackerText(payload.name, 160, true);
      const supplier = strictTrackerText(payload.supplier ?? "", 120);
      const supplierCountry = country(payload.supplierCountry);
      const accounting = parseAccounting(payload, "PURCHASE", quantity, enteredUnitPriceOre, shippingOre);
      if (!name || supplier === null || supplierCountry === null || !accounting) {
        return noStoreJson({ error: "The purchase or VAT details contain invalid values.", errorCode: "INVALID_PURCHASE" }, { status: 400 });
      }
      const newProductId = productId();
      const id = transactionId();
      const amounts = accounting.amounts;
      await db.batch([
        db.prepare(`INSERT INTO tracker_products
          (id, name, quantity, remaining_quantity, purchase_price_ore, purchase_shipping_ore, supplier, purchase_date, status, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'IN_STOCK', ?)`)
          .bind(newProductId, name, quantity, quantity, amounts.unitPriceOre, amounts.shippingOre, supplier, occurredAt, notes),
        db.prepare(`INSERT INTO tracker_transactions
          (id, product_id, type, quantity, unit_price_ore, shipping_ore, supplier, cost_basis_ore, total_costs_ore,
           notes, entered_unit_price_ore, entered_shipping_ore, price_mode, vat_treatment, vat_rate_bps, gross_amount_ore, input_vat_ore, output_vat_ore,
           deductible_vat_ore, supplier_country, occurred_at, updated_at)
          VALUES (?, ?, 'PURCHASE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`)
          .bind(id, newProductId, quantity, amounts.unitPriceOre, amounts.shippingOre, supplier || null,
            amounts.economicPurchaseCostOre, amounts.economicPurchaseCostOre, notes, enteredUnitPriceOre, shippingOre, accounting.priceMode,
            accounting.vatTreatment, accounting.vatRateBps, amounts.grossAmountOre, amounts.inputVatOre,
            amounts.outputVatOre, amounts.deductibleVatOre, supplierCountry || null, occurredAt),
      ]);
      const transaction = await db.prepare(`SELECT ${transactionSelect} FROM tracker_transactions t JOIN tracker_products p ON p.id = t.product_id WHERE t.id = ?`).bind(id).first<TrackerTransaction>();
      return noStoreJson({ transaction }, { status: 201 });
    }

    if (payload.type === "SALE") {
      const selectedProductId = strictTrackerText(payload.productId, 80, true);
      const platform = strictTrackerText(payload.platform, 120, true);
      const customerCountry = country(payload.customerCountry);
      const isB2b = trackerBoolean(payload.isB2b ?? false);
      const vatIdReference = strictTrackerText(payload.vatIdReference ?? "", 80);
      const feeOre = trackerInteger(payload.feeOre ?? 0);
      const promotedFeeOre = trackerInteger(payload.promotedFeeOre ?? 0);
      const otherCostsOre = trackerInteger(payload.otherCostsOre ?? 0);
      const accounting = parseAccounting(payload, "SALE", quantity, enteredUnitPriceOre, shippingOre);
      if (!selectedProductId || !platform || customerCountry === null || isB2b === null || vatIdReference === null ||
          feeOre === null || promotedFeeOre === null || otherCostsOre === null || !accounting) {
        return noStoreJson({ error: "The sale or VAT details contain invalid values.", errorCode: "INVALID_SALE" }, { status: 400 });
      }
      if (accounting.vatTreatment === "EU_B2B_SALE_REVERSE_CHARGE" && (!isB2b || !customerCountry || !vatIdReference)) {
        return noStoreJson({ error: "EU B2B reverse charge requires a customer country and VAT ID reference.", errorCode: "EU_B2B_DETAILS_REQUIRED" }, { status: 400 });
      }
      const product = await loadProduct(db, selectedProductId);
      if (!product) return noStoreJson({ error: "The selected inventory item no longer exists.", errorCode: "PRODUCT_NOT_FOUND" }, { status: 404 });
      if (product.remainingQuantity < quantity) return noStoreJson({ error: `Only ${product.remainingQuantity} units remain in inventory.`, errorCode: "INSUFFICIENT_INVENTORY", available: product.remainingQuantity }, { status: 409 });

      const id = transactionId();
      const candidate: SaleLedgerInput = {
        id, quantity, revenueOre: accounting.amounts.revenueOre, feeOre, promotedFeeOre,
        shippingOre, otherCostsOre, occurredAt, createdAt: new Date().toISOString(),
      };
      const ledger = recalculateProductSales(product, [...await loadSales(db, selectedProductId), candidate]);
      const sale = ledger.sales.find((row) => row.id === id)!;
      await db.batch([
        db.prepare(`INSERT INTO tracker_transactions
          (id, product_id, type, quantity, unit_price_ore, shipping_ore, platform, fee_ore, promoted_fee_ore,
           other_costs_ore, cost_basis_ore, revenue_ore, total_costs_ore, net_profit_ore, notes,
           entered_unit_price_ore, entered_shipping_ore, entered_total_price_ore, price_mode,
           vat_treatment, vat_rate_bps, gross_amount_ore, input_vat_ore, output_vat_ore, deductible_vat_ore,
           customer_country, is_b2b, vat_id_reference, occurred_at, updated_at)
          VALUES (?, ?, 'SALE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`)
          .bind(id, selectedProductId, quantity, accounting.amounts.unitPriceOre, shippingOre, platform, feeOre,
            promotedFeeOre, otherCostsOre, sale.costBasisOre, sale.revenueOre, sale.totalCostsOre, sale.netProfitOre,
            notes, enteredUnitPriceOre, shippingOre, parseOptionalMoney(payload.totalPriceOre), accounting.priceMode, accounting.vatTreatment, accounting.vatRateBps, accounting.amounts.grossAmountOre,
            accounting.amounts.inputVatOre, accounting.amounts.outputVatOre, accounting.amounts.deductibleVatOre,
            customerCountry || null, isB2b ? 1 : 0, vatIdReference || null, occurredAt),
        db.prepare(`UPDATE tracker_products SET remaining_quantity = ?, status = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`).bind(ledger.remainingQuantity, statusForRemaining(product.status, ledger.remainingQuantity), selectedProductId),
        ...saleRecalculationStatements(db, ledger.sales.filter((row) => row.id !== id)),
      ]);
      const transaction = await db.prepare(`SELECT ${transactionSelect} FROM tracker_transactions t JOIN tracker_products p ON p.id = t.product_id WHERE t.id = ?`).bind(id).first<TrackerTransaction>();
      return noStoreJson({ transaction }, { status: 201 });
    }
    return noStoreJson({ error: "Transaction type must be PURCHASE or SALE.", errorCode: "INVALID_TRANSACTION_TYPE" }, { status: 400 });
  } catch (error) {
    return trackerError(error, "Unable to save the transaction.");
  }
}

export async function PATCH(request: Request) {
  const db = trackerDb();
  if (!db) return trackerUnavailable();
  try {
    const payload = await request.json() as Record<string, unknown>;
    const id = strictTrackerText(payload.id, 80, true);
    if (!id) return noStoreJson({ error: "Invalid transaction.", errorCode: "INVALID_TRANSACTION" }, { status: 400 });
    const existing = await db.prepare(`SELECT ${transactionSelect} FROM tracker_transactions t JOIN tracker_products p ON p.id = t.product_id WHERE t.id = ?`).bind(id).first<TrackerTransaction>();
    if (!existing) return noStoreJson({ error: "This transaction no longer exists.", errorCode: "TRANSACTION_NOT_FOUND" }, { status: 404 });

    const quantity = trackerInteger(payload.quantity, { min: 1, max: 1_000_000 });
    const enteredUnitPriceOre = trackerInteger(payload.unitPriceOre, { min: existing.type === "SALE" ? 1 : 0 });
    const shippingOre = trackerInteger(payload.shippingOre ?? 0);
    const occurredAt = trackerDate(payload.occurredAt);
    const notes = strictTrackerText(payload.notes ?? "", 2_000);
    if (quantity === null || enteredUnitPriceOre === null || shippingOre === null || !occurredAt || notes === null) {
      return noStoreJson({ error: "The transaction update contains invalid values.", errorCode: "INVALID_TRANSACTION" }, { status: 400 });
    }

    if (existing.type === "PURCHASE") {
      const product = await loadProduct(db, existing.productId);
      const name = strictTrackerText(payload.name ?? existing.productName, 160, true);
      const supplier = strictTrackerText(payload.supplier ?? existing.supplier ?? "", 120);
      const supplierCountry = country(payload.supplierCountry);
      const accounting = parseAccounting(payload, "PURCHASE", quantity, enteredUnitPriceOre, shippingOre);
      if (!product || !name || supplier === null || supplierCountry === null || !accounting) {
        return noStoreJson({ error: "The purchase update or VAT details contain invalid values.", errorCode: "INVALID_PURCHASE" }, { status: 400 });
      }
      const sales = await loadSales(db, product.id);
      let ledger: ReturnType<typeof recalculateProductSales>;
      try { ledger = recalculateProductSales({ ...product, quantity, purchasePriceOre: accounting.amounts.unitPriceOre, purchaseShippingOre: accounting.amounts.shippingOre }, sales); }
      catch { return noStoreJson({ error: "Quantity cannot be lower than the units already sold.", errorCode: "PURCHASE_BELOW_SOLD" }, { status: 409 }); }
      const finalStatus = statusForRemaining(product.status, ledger.remainingQuantity);
      await db.batch([
        db.prepare(`UPDATE tracker_products SET name = ?, quantity = ?, remaining_quantity = ?, purchase_price_ore = ?,
          purchase_shipping_ore = ?, supplier = ?, purchase_date = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
          .bind(name, quantity, ledger.remainingQuantity, accounting.amounts.unitPriceOre, accounting.amounts.shippingOre,
            supplier, occurredAt, finalStatus, product.id),
        db.prepare(`UPDATE tracker_transactions SET quantity = ?, unit_price_ore = ?, shipping_ore = ?, supplier = ?,
          cost_basis_ore = ?, total_costs_ore = ?, notes = ?, entered_unit_price_ore = ?, entered_shipping_ore = ?,
          price_mode = ?, vat_treatment = ?, vat_rate_bps = ?,
          gross_amount_ore = ?, input_vat_ore = ?, output_vat_ore = ?, deductible_vat_ore = ?, supplier_country = ?,
          occurred_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
          .bind(quantity, accounting.amounts.unitPriceOre, accounting.amounts.shippingOre, supplier || null,
            accounting.amounts.economicPurchaseCostOre, accounting.amounts.economicPurchaseCostOre, notes,
            enteredUnitPriceOre, shippingOre,
            accounting.priceMode, accounting.vatTreatment, accounting.vatRateBps, accounting.amounts.grossAmountOre,
            accounting.amounts.inputVatOre, accounting.amounts.outputVatOre, accounting.amounts.deductibleVatOre,
            supplierCountry || null, occurredAt, id),
        ...saleRecalculationStatements(db, ledger.sales),
      ]);
    } else {
      const nextProductId = strictTrackerText(payload.productId ?? existing.productId, 80, true);
      const platform = strictTrackerText(payload.platform, 120, true);
      const customerCountry = country(payload.customerCountry);
      const isB2b = trackerBoolean(payload.isB2b ?? false);
      const vatIdReference = strictTrackerText(payload.vatIdReference ?? "", 80);
      const feeOre = trackerInteger(payload.feeOre ?? 0);
      const promotedFeeOre = trackerInteger(payload.promotedFeeOre ?? 0);
      const otherCostsOre = trackerInteger(payload.otherCostsOre ?? 0);
      const accounting = parseAccounting(payload, "SALE", quantity, enteredUnitPriceOre, shippingOre);
      if (!nextProductId || !platform || customerCountry === null || isB2b === null || vatIdReference === null ||
          feeOre === null || promotedFeeOre === null || otherCostsOre === null || !accounting) {
        return noStoreJson({ error: "The sale update or VAT details contain invalid values.", errorCode: "INVALID_SALE" }, { status: 400 });
      }
      if (accounting.vatTreatment === "EU_B2B_SALE_REVERSE_CHARGE" && (!isB2b || !customerCountry || !vatIdReference)) {
        return noStoreJson({ error: "EU B2B reverse charge requires a customer country and VAT ID reference.", errorCode: "EU_B2B_DETAILS_REQUIRED" }, { status: 400 });
      }
      const oldProduct = await loadProduct(db, existing.productId);
      const newProduct = nextProductId === existing.productId ? oldProduct : await loadProduct(db, nextProductId);
      if (!oldProduct || !newProduct) return noStoreJson({ error: "The selected inventory item no longer exists.", errorCode: "PRODUCT_NOT_FOUND" }, { status: 404 });

      const replacement: SaleRow = {
        id, productId: nextProductId, quantity, revenueOre: accounting.amounts.revenueOre, feeOre,
        promotedFeeOre, shippingOre, otherCostsOre, occurredAt, createdAt: existing.createdAt,
      };
      const oldSales = await loadSales(db, oldProduct.id);
      let oldLedger: ReturnType<typeof recalculateProductSales>;
      let newLedger: ReturnType<typeof recalculateProductSales>;
      try {
        if (oldProduct.id === newProduct.id) {
          newLedger = recalculateProductSales(newProduct, oldSales.map((sale) => sale.id === id ? replacement : sale));
          oldLedger = newLedger;
        } else {
          oldLedger = recalculateProductSales(oldProduct, oldSales.filter((sale) => sale.id !== id));
          newLedger = recalculateProductSales(newProduct, [...await loadSales(db, newProduct.id), replacement]);
        }
      } catch {
        return noStoreJson({ error: `Only ${newProduct.remainingQuantity + (newProduct.id === oldProduct.id ? existing.quantity : 0)} units are available for this sale.`, errorCode: "INSUFFICIENT_INVENTORY" }, { status: 409 });
      }
      const current = newLedger.sales.find((sale) => sale.id === id)!;
      const statements = [
        db.prepare(`UPDATE tracker_transactions SET product_id = ?, quantity = ?, unit_price_ore = ?, shipping_ore = ?,
          platform = ?, fee_ore = ?, promoted_fee_ore = ?, other_costs_ore = ?, cost_basis_ore = ?, revenue_ore = ?,
          total_costs_ore = ?, net_profit_ore = ?, notes = ?, entered_unit_price_ore = ?, entered_shipping_ore = ?, entered_total_price_ore = ?,
          price_mode = ?, vat_treatment = ?, vat_rate_bps = ?,
          gross_amount_ore = ?, input_vat_ore = ?, output_vat_ore = ?, deductible_vat_ore = ?, customer_country = ?,
          is_b2b = ?, vat_id_reference = ?, occurred_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
          .bind(nextProductId, quantity, accounting.amounts.unitPriceOre, shippingOre, platform, feeOre, promotedFeeOre,
            otherCostsOre, current.costBasisOre, current.revenueOre, current.totalCostsOre, current.netProfitOre, notes,
            enteredUnitPriceOre, shippingOre, parseOptionalMoney(payload.totalPriceOre),
            accounting.priceMode, accounting.vatTreatment, accounting.vatRateBps, accounting.amounts.grossAmountOre,
            accounting.amounts.inputVatOre, accounting.amounts.outputVatOre, accounting.amounts.deductibleVatOre,
            customerCountry || null, isB2b ? 1 : 0, vatIdReference || null, occurredAt, id),
        db.prepare(`UPDATE tracker_products SET remaining_quantity = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
          .bind(oldLedger.remainingQuantity, statusForRemaining(oldProduct.status, oldLedger.remainingQuantity), oldProduct.id),
      ];
      if (newProduct.id !== oldProduct.id) statements.push(
        db.prepare(`UPDATE tracker_products SET remaining_quantity = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
          .bind(newLedger.remainingQuantity, statusForRemaining(newProduct.status, newLedger.remainingQuantity), newProduct.id),
      );
      statements.push(...saleRecalculationStatements(db, oldLedger.sales.filter((sale) => sale.id !== id)));
      if (newProduct.id !== oldProduct.id) statements.push(...saleRecalculationStatements(db, newLedger.sales.filter((sale) => sale.id !== id)));
      await db.batch(statements);
    }

    const transaction = await db.prepare(`SELECT ${transactionSelect} FROM tracker_transactions t JOIN tracker_products p ON p.id = t.product_id WHERE t.id = ?`).bind(id).first<TrackerTransaction>();
    return noStoreJson({ transaction });
  } catch (error) {
    return trackerError(error, "Unable to update the transaction.");
  }
}

export async function DELETE(request: Request) {
  const db = trackerDb();
  if (!db) return trackerUnavailable();
  try {
    const payload = await request.json() as Record<string, unknown>;
    const id = strictTrackerText(payload.id, 80, true);
    if (!id) return noStoreJson({ error: "Invalid transaction.", errorCode: "INVALID_TRANSACTION" }, { status: 400 });
    const existing = await db.prepare(`SELECT ${transactionSelect} FROM tracker_transactions t JOIN tracker_products p ON p.id = t.product_id WHERE t.id = ?`).bind(id).first<TrackerTransaction>();
    if (!existing) return noStoreJson({ error: "This transaction no longer exists.", errorCode: "TRANSACTION_NOT_FOUND" }, { status: 404 });
    if (existing.type === "PURCHASE") {
      const sales = await loadSales(db, existing.productId);
      if (sales.length) return noStoreJson({ error: "Delete the related sales before deleting this purchase.", errorCode: "PURCHASE_HAS_SALES" }, { status: 409 });
      await db.batch([
        db.prepare("DELETE FROM tracker_transactions WHERE id = ?").bind(id),
        db.prepare("DELETE FROM tracker_products WHERE id = ?").bind(existing.productId),
      ]);
    } else {
      const product = await loadProduct(db, existing.productId);
      if (!product) return noStoreJson({ error: "The related inventory item no longer exists.", errorCode: "PRODUCT_NOT_FOUND" }, { status: 409 });
      const ledger = recalculateProductSales(product, (await loadSales(db, product.id)).filter((sale) => sale.id !== id));
      await db.batch([
        db.prepare("DELETE FROM tracker_transactions WHERE id = ?").bind(id),
        db.prepare(`UPDATE tracker_products SET remaining_quantity = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
          .bind(ledger.remainingQuantity, statusForRemaining(product.status, ledger.remainingQuantity), product.id),
        ...saleRecalculationStatements(db, ledger.sales),
      ]);
    }
    return noStoreJson({ id, deleted: true });
  } catch (error) {
    return trackerError(error, "Unable to delete the transaction.");
  }
}
