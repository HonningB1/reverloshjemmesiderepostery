#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const MAX_MONEY_ORE = 100_000_000_000;
const ACCEPTED_SALE_STATUSES = new Set(["Gennemført", "Afsendt", "Solgt"]);

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function canonicalHash(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function dkkToOre(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  const ore = Math.round((value + Number.EPSILON) * 100);
  return Number.isSafeInteger(ore) && ore <= MAX_MONEY_ORE ? ore : null;
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function cleanText(value, maxLength, required = false) {
  if (value === undefined || value === null) return required ? null : "";
  if (typeof value !== "string") return null;
  const text = value.trim();
  if ((required && !text) || text.length > maxLength || text.includes("\0")) return null;
  return text;
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function nonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function legacyId(value) {
  const id = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : typeof value === "string" ? value.trim() : "";
  return /^[A-Za-z0-9_-]{1,48}$/.test(id) ? id : null;
}

function moneyField(value, issues, context, field, required = true) {
  if (!required && (value === undefined || value === null || value === "")) return 0;
  const ore = dkkToOre(value);
  if (ore === null) issues.push({ severity: "CRITICAL", context, message: `${field} is not a valid non-negative DKK amount.` });
  return ore;
}

function compareOre(expected, actual, issues, context, message, tolerance = 1) {
  if (expected !== null && actual !== null && Math.abs(expected - actual) > tolerance) {
    issues.push({ severity: "CRITICAL", context, message: `${message} (${formatDkk(expected)} vs ${formatDkk(actual)}).` });
  }
}

function allocatedShipping(totalShippingOre, totalQuantity, soldBefore, soldQuantity) {
  const shipping = BigInt(totalShippingOre);
  const quantity = BigInt(totalQuantity);
  const before = (shipping * BigInt(soldBefore)) / quantity;
  const after = (shipping * BigInt(soldBefore + soldQuantity)) / quantity;
  return Number(after - before);
}

function deterministicIds(oldId, kind) {
  if (kind === "product") return `prd_rst_${oldId}`;
  if (kind === "purchase") return `txn_rst_purchase_${oldId}`;
  if (kind === "sale") return `txn_rst_sale_${oldId}`;
  if (kind === "expense") return `exp_rst_${oldId}`;
  if (kind === "subscription") return `sub_rst_${oldId}`;
  return `subpay_rst_${oldId}`;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function analyseResellTrack(data, sourceName = "reselltrack-data.json") {
  const issues = [];
  const products = [];
  const purchases = [];
  const parsedSales = [];
  const expenses = [];
  const subscriptions = [];
  const subscriptionPayments = [];

  if (!isRecord(data)) {
    return {
      sourceName, sourceSha256: "", importId: "", products, purchases, sales: [], expenses, subscriptions, subscriptionPayments,
      issues: [{ severity: "CRITICAL", context: "file", message: "The JSON root must be an object." }],
      ignored: {}, summary: emptySummary(), canApply: false,
    };
  }

  const sourceSha256 = canonicalHash(data);
  const importId = `imp_rst_${sourceSha256}`;
  if (data.settings?.currency !== "DKK") {
    issues.push({ severity: "CRITICAL", context: "settings", message: "settings.currency must be DKK before converted monetary fields can be trusted." });
  }
  if (!Array.isArray(data.inventory)) issues.push({ severity: "CRITICAL", context: "inventory", message: "inventory must be an array." });
  if (!Array.isArray(data.sales)) issues.push({ severity: "CRITICAL", context: "sales", message: "sales must be an array." });
  if (!Array.isArray(data.expenses)) issues.push({ severity: "CRITICAL", context: "expenses", message: "expenses must be an array." });
  if (!Array.isArray(data.subs)) issues.push({ severity: "CRITICAL", context: "subs", message: "subs must be an array." });

  const inventoryIds = new Set();
  for (const [index, record] of (Array.isArray(data.inventory) ? data.inventory : []).entries()) {
    const fallbackContext = `inventory[${index}]`;
    if (!isRecord(record)) {
      issues.push({ severity: "CRITICAL", context: fallbackContext, message: "Inventory record must be an object." });
      continue;
    }
    const oldId = legacyId(record.id);
    const context = oldId ? `inventory ${oldId}` : fallbackContext;
    if (!oldId) {
      issues.push({ severity: "CRITICAL", context, message: "Inventory id is missing or unsafe." });
      continue;
    }
    if (inventoryIds.has(oldId)) {
      issues.push({ severity: "CRITICAL", context, message: "Duplicate inventory id." });
      continue;
    }
    inventoryIds.add(oldId);

    const name = cleanText(record.name, 160, true);
    const supplier = cleanText(record.platform, 120);
    const notes = cleanText(record.note, 2_000);
    const quantity = positiveInteger(record.purchaseQty);
    const oldRemainingQuantity = nonNegativeInteger(record.qty);
    const purchaseDate = validDate(record.buyDate) ? record.buyDate : null;
    const canonicalUnitCostOre = moneyField(record.buyPrice, issues, context, "buyPrice");
    if (!name) issues.push({ severity: "CRITICAL", context, message: "Product name is missing, invalid, or longer than 160 characters." });
    if (supplier === null) issues.push({ severity: "CRITICAL", context, message: "Supplier/platform is invalid or longer than 120 characters." });
    if (notes === null) issues.push({ severity: "CRITICAL", context, message: "Product note is invalid or longer than 2,000 characters." });
    if (!quantity) issues.push({ severity: "CRITICAL", context, message: "purchaseQty must be a positive integer." });
    if (oldRemainingQuantity === null) issues.push({ severity: "CRITICAL", context, message: "qty must be a non-negative integer." });
    if (quantity && oldRemainingQuantity !== null && oldRemainingQuantity > quantity) {
      issues.push({ severity: "CRITICAL", context, message: "Remaining qty exceeds purchaseQty." });
    }
    if (!purchaseDate) issues.push({ severity: "CRITICAL", context, message: "buyDate is missing or invalid." });

    let purchasePriceOre = canonicalUnitCostOre;
    let purchaseShippingOre = 0;
    if (canonicalUnitCostOre !== null && quantity && record.shipping !== undefined && record.shipping !== null) {
      purchaseShippingOre = moneyField(record.shipping, issues, context, "shipping");
      if (purchaseShippingOre !== null) {
        const totalCostOre = canonicalUnitCostOre * quantity;
        const baseCostOre = totalCostOre - purchaseShippingOre;
        if (baseCostOre < 0 || baseCostOre % quantity !== 0) {
          issues.push({
            severity: "CRITICAL", context,
            message: "Converted purchase shipping cannot be separated from buyPrice exactly in integer øre without changing total cost.",
          });
          purchasePriceOre = null;
        } else {
          purchasePriceOre = baseCostOre / quantity;
        }
      }
    }

    if (purchasePriceOre !== null && record.rawBuyPrice !== undefined && record.currency === "DKK") {
      compareOre(purchasePriceOre, dkkToOre(record.rawBuyPrice), issues, context, "rawBuyPrice does not reconcile with the DKK purchase base price");
    }
    if (purchaseShippingOre !== null && record.rawShipping !== undefined && record.shippingCurrency === "DKK") {
      compareOre(purchaseShippingOre, dkkToOre(record.rawShipping), issues, context, "rawShipping does not reconcile with converted DKK purchase shipping");
    }
    if (canonicalUnitCostOre !== null && record.costPerUnit !== undefined) {
      compareOre(canonicalUnitCostOre, dkkToOre(record.costPerUnit), issues, context, "costPerUnit does not reconcile with buyPrice");
    }
    if (canonicalUnitCostOre !== null && quantity && record.netCost !== undefined) {
      compareOre(canonicalUnitCostOre * quantity, dkkToOre(record.netCost), issues, context, "netCost does not reconcile with buyPrice × purchaseQty");
    }

    const recordHasCritical = issues.some((issue) => issue.severity === "CRITICAL" && issue.context === context);
    if (recordHasCritical || !name || supplier === null || notes === null || !quantity || oldRemainingQuantity === null || !purchaseDate || purchasePriceOre === null || purchaseShippingOre === null) continue;
    const id = deterministicIds(oldId, "product");
    const totalPurchaseOre = purchasePriceOre * quantity + purchaseShippingOre;
    let vat = null;
    if (record.purchaseType === "business-vat") {
      const enteredUnitPriceOre = dkkToOre(record.grossBuyPrice);
      const enteredShippingOre = dkkToOre(record.grossShipping ?? 0);
      const inputVatOre = dkkToOre(record.inputVat);
      const deductibleVatOre = dkkToOre(record.recoverableVat);
      const grossAmountOre = dkkToOre(record.cashPaid);
      if ([enteredUnitPriceOre, enteredShippingOre, inputVatOre, deductibleVatOre, grossAmountOre].some((value) => value === null) ||
          enteredUnitPriceOre * quantity + enteredShippingOre !== grossAmountOre || grossAmountOre - deductibleVatOre !== totalPurchaseOre ||
          inputVatOre !== deductibleVatOre) {
        issues.push({ severity: "CRITICAL", context, message: "Explicit business purchase VAT fields do not reconcile exactly with gross cash paid and imported net cost." });
      } else {
        const supplierCountry = typeof record.supplierCountry === "string" ? record.supplierCountry.trim().toUpperCase() : "";
        vat = { enteredUnitPriceOre, enteredShippingOre, priceMode: "VAT_INCLUSIVE",
          vatTreatment: supplierCountry === "DK" ? "DANISH_PURCHASE_DEDUCTIBLE" : "CUSTOM_MANUAL",
          vatRateBps: 2500, grossAmountOre, inputVatOre, outputVatOre: 0, deductibleVatOre,
          supplierCountry: supplierCountry || "" };
        if (!supplierCountry) issues.push({ severity: "WARNING", context, message: "Business purchase VAT reconciles, but supplier country is absent; treatment is preserved as CUSTOM_MANUAL instead of assuming a Danish purchase." });
      }
    } else if (record.purchaseType === "private") {
      const enteredUnitPriceOre = dkkToOre(record.grossBuyPrice);
      const enteredShippingOre = dkkToOre(record.grossShipping ?? 0);
      const inputVatOre = dkkToOre(record.inputVat ?? 0);
      const grossAmountOre = enteredUnitPriceOre === null || enteredShippingOre === null ? null : enteredUnitPriceOre * quantity + enteredShippingOre;
      if (enteredUnitPriceOre === null || enteredShippingOre === null || inputVatOre !== 0 || grossAmountOre !== totalPurchaseOre) {
        issues.push({ severity: "CRITICAL", context, message: "Explicit private purchase fields do not reconcile exactly with imported non-deductible cost." });
      } else {
        vat = { enteredUnitPriceOre, enteredShippingOre, priceMode: "VAT_INCLUSIVE", vatTreatment: "PRIVATE_PURCHASE_NO_DEDUCTION", vatRateBps: 0, grossAmountOre, inputVatOre: 0, outputVatOre: 0, deductibleVatOre: 0 };
      }
    } else {
      issues.push({ severity: "WARNING", context, message: "Purchase VAT treatment is absent; VAT metadata remains unknown and is not inferred." });
    }
    const product = {
      id, oldId, name, quantity, oldRemainingQuantity, purchasePriceOre, purchaseShippingOre,
      supplier, purchaseDate, status: oldRemainingQuantity === 0 ? "SOLD" : "IN_STOCK", notes, vat,
    };
    products.push(product);
    purchases.push({
      id: deterministicIds(oldId, "purchase"), productId: id, oldId, quantity,
      unitPriceOre: purchasePriceOre, shippingOre: purchaseShippingOre, supplier,
      costBasisOre: totalPurchaseOre, totalCostsOre: totalPurchaseOre, occurredAt: purchaseDate, notes, vat,
    });
  }

  const productByOldId = new Map(products.map((product) => [product.oldId, product]));
  const saleIds = new Set();
  for (const [index, record] of (Array.isArray(data.sales) ? data.sales : []).entries()) {
    const fallbackContext = `sales[${index}]`;
    if (!isRecord(record)) {
      issues.push({ severity: "CRITICAL", context: fallbackContext, message: "Sale record must be an object." });
      continue;
    }
    const oldId = legacyId(record.id);
    const oldProductId = legacyId(record.productId);
    const context = oldId ? `sale ${oldId}` : fallbackContext;
    if (!oldId) issues.push({ severity: "CRITICAL", context, message: "Sale id is missing or unsafe." });
    if (oldId && saleIds.has(oldId)) issues.push({ severity: "CRITICAL", context, message: "Duplicate sale id." });
    if (oldId) saleIds.add(oldId);
    const product = oldProductId ? productByOldId.get(oldProductId) : null;
    if (!oldProductId || !product) issues.push({ severity: "CRITICAL", context, message: "Sale productId does not reference an importable inventory record." });

    const quantity = positiveInteger(record.qty);
    const occurredAt = validDate(record.date) ? record.date : null;
    const platform = cleanText(record.platform, 80, true);
    const notes = cleanText(record.note, 2_000);
    if (!quantity) issues.push({ severity: "CRITICAL", context, message: "Sale qty must be a positive integer." });
    if (!occurredAt) issues.push({ severity: "CRITICAL", context, message: "Sale date is missing or invalid." });
    if (!platform) issues.push({ severity: "CRITICAL", context, message: "Sale platform is missing, invalid, or longer than 80 characters." });
    if (notes === null) issues.push({ severity: "CRITICAL", context, message: "Sale note is invalid or longer than 2,000 characters." });
    if (!ACCEPTED_SALE_STATUSES.has(record.saleStatus)) {
      issues.push({ severity: "CRITICAL", context, message: `Sale status ${JSON.stringify(record.saleStatus)} is not recognized as completed/fulfilled.` });
    }
    if (product && typeof record.name === "string" && record.name.trim() !== product.name) {
      issues.push({ severity: "CRITICAL", context, message: `Sale product name does not match linked inventory product ${JSON.stringify(product.name)}.` });
    }

    const salePriceOre = moneyField(record.salePrice, issues, context, "salePrice");
    const revenueOre = record.revenueDkk === undefined
      ? salePriceOre
      : moneyField(record.revenueDkk, issues, context, "revenueDkk");
    if (record.revenueDkk !== undefined) compareOre(revenueOre, salePriceOre, issues, context, "revenueDkk does not reconcile with salePrice");
    const unitPriceOre = record.unitSalePrice === undefined
      ? (revenueOre !== null && quantity ? Math.round(revenueOre / quantity) : null)
      : moneyField(record.unitSalePrice, issues, context, "unitSalePrice");
    if (unitPriceOre !== null && revenueOre !== null && quantity && Math.abs(unitPriceOre * quantity - revenueOre) > Math.max(1, quantity - 1)) {
      issues.push({ severity: "CRITICAL", context, message: "unitSalePrice × qty does not reconcile with DKK revenue." });
    } else if (unitPriceOre !== null && revenueOre !== null && quantity && unitPriceOre * quantity !== revenueOre) {
      issues.push({
        severity: "WARNING", context,
        message: `Rounded unitSalePrice × qty differs from total revenue by ${Math.abs(unitPriceOre * quantity - revenueOre)} øre; exact total revenue is preserved.`,
      });
    }

    const feeOre = moneyField(record.fee ?? 0, issues, context, "fee");
    const shippingOre = moneyField(record.shipping ?? 0, issues, context, "shipping");
    let otherCostsOre = 0;
    if (record.sellingExpenses !== undefined) {
      const sellingExpensesOre = moneyField(record.sellingExpenses, issues, context, "sellingExpenses");
      if (sellingExpensesOre !== null && feeOre !== null && shippingOre !== null) {
        otherCostsOre = sellingExpensesOre - feeOre - shippingOre;
        if (otherCostsOre < -1) issues.push({ severity: "CRITICAL", context, message: "sellingExpenses is lower than fee + shipping." });
        else if (otherCostsOre < 0) otherCostsOre = 0;
      }
    }
    if (record.saleExchangeRate !== undefined && record.rawSalePrice !== undefined) {
      compareOre(revenueOre, dkkToOre(record.rawSalePrice * record.saleExchangeRate), issues, context, "rawSalePrice × saleExchangeRate does not reconcile with DKK revenue");
    }
    if (record.feeExchangeRate !== undefined && record.rawFee !== undefined) {
      compareOre(feeOre, dkkToOre(record.rawFee * record.feeExchangeRate), issues, context, "rawFee × feeExchangeRate does not reconcile with the DKK fee");
    }
    if (record.shippingExchangeRate !== undefined && record.rawShipping !== undefined) {
      compareOre(shippingOre, dkkToOre(record.rawShipping * record.shippingExchangeRate), issues, context, "rawShipping × shippingExchangeRate does not reconcile with DKK shipping");
    }
    let vat = null;
    if (record.vatTreatment === "eu-b2b-reverse-charge" && record.vatType === "EU_B2B") {
      const outputVatOre = dkkToOre(record.outputVat);
      const grossAmountOre = dkkToOre(record.grossSalePrice);
      const customerCountry = cleanText(record.customerCountry, 2, true);
      const vatIdReference = cleanText(record.customerVatNumber, 80, true);
      if (record.vatRate !== 0 || outputVatOre !== 0 || grossAmountOre !== revenueOre || record.customerType !== "business" ||
          record.customerVatVerified !== true || !customerCountry || !vatIdReference) {
        issues.push({ severity: "CRITICAL", context, message: "EU B2B reverse-charge evidence or 0% VAT amounts are incomplete or inconsistent." });
      } else {
        vat = { enteredUnitPriceOre: unitPriceOre, enteredShippingOre: shippingOre, enteredTotalPriceOre: grossAmountOre, priceMode: "VAT_EXCLUSIVE", vatTreatment: "EU_B2B_SALE_REVERSE_CHARGE", vatRateBps: 0, grossAmountOre, inputVatOre: 0, outputVatOre: 0, deductibleVatOre: 0, customerCountry: customerCountry.toUpperCase(), isB2b: true, vatIdReference };
      }
    } else if (record.vatTreatment === "private-sale" && record.vatType === "PRIVATE_SALE") {
      const outputVatOre = dkkToOre(record.outputVat);
      const grossAmountOre = dkkToOre(record.grossSalePrice);
      const customerCountry = cleanText(record.customerCountry, 2);
      if (record.vatRate !== 0 || outputVatOre !== 0 || grossAmountOre !== revenueOre || record.sellerType !== "private") {
        issues.push({ severity: "CRITICAL", context, message: "Explicit private-sale VAT fields do not reconcile with revenue." });
      } else {
        vat = { enteredUnitPriceOre: unitPriceOre, enteredShippingOre: shippingOre, enteredTotalPriceOre: grossAmountOre, priceMode: "VAT_EXCLUSIVE", vatTreatment: "NO_VAT_OUTSIDE_SCOPE", vatRateBps: 0, grossAmountOre, inputVatOre: 0, outputVatOre: 0, deductibleVatOre: 0, customerCountry: customerCountry ? customerCountry.toUpperCase() : "", isB2b: false, vatIdReference: "" };
      }
    } else {
      issues.push({ severity: "WARNING", context, message: "Sale VAT treatment is absent; VAT metadata remains unknown and is not inferred." });
    }

    const recordHasCritical = issues.some((issue) => issue.severity === "CRITICAL" && issue.context === context);
    if (recordHasCritical || !oldId || !product || !quantity || !occurredAt || !platform || unitPriceOre === null || revenueOre === null || feeOre === null || shippingOre === null) continue;
    parsedSales.push({
      id: deterministicIds(oldId, "sale"), oldId, oldProductId, productId: product.id,
      quantity, unitPriceOre, shippingOre, platform, feeOre, promotedFeeOre: 0,
      otherCostsOre, revenueOre, occurredAt, oldCostPriceOre: dkkToOre(record.costPrice), oldProfitOre: dkkToOre(record.profit),
      sourceIndex: index, notes, vat,
    });
  }

  const sales = [];
  const salesByProduct = new Map();
  for (const sale of parsedSales) {
    const list = salesByProduct.get(sale.oldProductId) ?? [];
    list.push(sale);
    salesByProduct.set(sale.oldProductId, list);
  }
  for (const product of products) {
    const productSales = (salesByProduct.get(product.oldId) ?? []).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.sourceIndex - b.sourceIndex);
    let soldBefore = 0;
    for (const sale of productSales) {
      const context = `sale ${sale.oldId}`;
      if (soldBefore + sale.quantity > product.quantity) {
        issues.push({ severity: "CRITICAL", context, message: `Product is oversold by ${soldBefore + sale.quantity - product.quantity} unit(s).` });
        continue;
      }
      const purchaseShippingAllocation = allocatedShipping(product.purchaseShippingOre, product.quantity, soldBefore, sale.quantity);
      const costBasisOre = product.purchasePriceOre * sale.quantity + purchaseShippingAllocation;
      const totalCostsOre = costBasisOre + sale.feeOre + sale.promotedFeeOre + sale.shippingOre + sale.otherCostsOre;
      const netProfitOre = sale.revenueOre - totalCostsOre;
      compareOre(costBasisOre, sale.oldCostPriceOre, issues, context, "Old costPrice does not reconcile with the new tracker cost basis");
      compareOre(netProfitOre, sale.oldProfitOre, issues, context, "Old profit does not reconcile with profit recalculated from source amounts");
      sales.push({ ...sale, costBasisOre, totalCostsOre, netProfitOre });
      soldBefore += sale.quantity;
    }
    const computedRemaining = product.quantity - soldBefore;
    if (computedRemaining !== product.oldRemainingQuantity) {
      issues.push({
        severity: "CRITICAL", context: `inventory ${product.oldId}`,
        message: `Inventory mismatch: old qty is ${product.oldRemainingQuantity}, but purchases minus sales gives ${computedRemaining}.`,
      });
    }
  }

  const expenseIds = new Set();
  for (const [index, record] of (Array.isArray(data.expenses) ? data.expenses : []).entries()) {
    const fallbackContext = `expenses[${index}]`;
    if (!isRecord(record)) {
      issues.push({ severity: "CRITICAL", context: fallbackContext, message: "Expense record must be an object." });
      continue;
    }
    const oldId = legacyId(record.id);
    const context = oldId ? `expense ${oldId}` : fallbackContext;
    if (!oldId) issues.push({ severity: "CRITICAL", context, message: "Expense id is missing or unsafe." });
    if (oldId && expenseIds.has(oldId)) issues.push({ severity: "CRITICAL", context, message: "Duplicate expense id." });
    if (oldId) expenseIds.add(oldId);
    const name = cleanText(record.name, 160, true);
    const category = cleanText(record.cat, 80, true);
    const notes = cleanText(record.note, 2_000);
    const occurredAt = validDate(record.date) ? record.date : null;
    const amountOre = moneyField(record.amount, issues, context, "amount");
    if (!name) issues.push({ severity: "CRITICAL", context, message: "Expense name is missing, invalid, or longer than 160 characters." });
    if (!category) issues.push({ severity: "CRITICAL", context, message: "Expense category is missing, invalid, or longer than 80 characters." });
    if (notes === null) issues.push({ severity: "CRITICAL", context, message: "Expense note is invalid or longer than 2,000 characters." });
    if (!occurredAt) issues.push({ severity: "CRITICAL", context, message: "Expense date is missing or invalid." });
    if (amountOre !== null && record.rawAmount !== undefined) {
      if (record.currency === "DKK") compareOre(amountOre, dkkToOre(record.rawAmount), issues, context, "rawAmount does not reconcile with the DKK expense amount");
      else if (typeof record.eurRate === "number" && record.eurRate > 1) compareOre(amountOre, dkkToOre(record.rawAmount * record.eurRate), issues, context, "rawAmount × conversion rate does not reconcile with the DKK expense amount");
    }
    const recordHasCritical = issues.some((issue) => issue.severity === "CRITICAL" && issue.context === context);
    if (recordHasCritical || !oldId || !name || !category || notes === null || !occurredAt || amountOre === null) continue;
    expenses.push({ id: deterministicIds(oldId, "expense"), oldId, name, amountOre, category, occurredAt, notes });
  }

  const subscriptionIds = new Set();
  const paymentIds = new Set();
  const billingPeriodMap = new Map([
    ["1", "MONTHLY"], ["3", "QUARTERLY"], ["12", "YEARLY"],
    ["WEEKLY", "WEEKLY"], ["MONTHLY", "MONTHLY"], ["QUARTERLY", "QUARTERLY"], ["YEARLY", "YEARLY"], ["CUSTOM", "CUSTOM"],
  ]);
  for (const [index, record] of (Array.isArray(data.subs) ? data.subs : []).entries()) {
    const fallbackContext = `subs[${index}]`;
    if (!isRecord(record)) {
      issues.push({ severity: "CRITICAL", context: fallbackContext, message: "Subscription record must be an object." });
      continue;
    }
    const oldId = legacyId(record.id);
    const context = oldId ? `subscription ${oldId}` : fallbackContext;
    if (!oldId) issues.push({ severity: "CRITICAL", context, message: "Subscription id is missing or unsafe." });
    if (oldId && subscriptionIds.has(oldId)) issues.push({ severity: "CRITICAL", context, message: "Duplicate subscription id." });
    if (oldId) subscriptionIds.add(oldId);
    const name = cleanText(record.name, 160, true);
    const category = cleanText(record.cat, 80, true);
    const notes = cleanText(record.note, 2_000);
    const costOre = moneyField(record.cost, issues, context, "cost");
    const billingPeriod = billingPeriodMap.get(String(record.period ?? "").toUpperCase()) ?? null;
    const nextPaymentDate = validDate(record.expire) ? record.expire : null;
    const autoRenew = record.auto === "Ja" || record.auto === true ? true : record.auto === "Nej" || record.auto === false ? false : null;
    const status = record.archived === true || record.status === "Historik" ? "ARCHIVED" : record.archived === false || record.status === "Aktiv" ? "ACTIVE" : null;
    if (!name) issues.push({ severity: "CRITICAL", context, message: "Subscription name is missing, invalid, or longer than 160 characters." });
    if (!category) issues.push({ severity: "CRITICAL", context, message: "Subscription category is missing, invalid, or longer than 80 characters." });
    if (notes === null) issues.push({ severity: "CRITICAL", context, message: "Subscription note is invalid or longer than 2,000 characters." });
    if (!billingPeriod) issues.push({ severity: "CRITICAL", context, message: `Billing period ${JSON.stringify(record.period)} cannot be mapped safely.` });
    if (!nextPaymentDate) issues.push({ severity: "CRITICAL", context, message: "Subscription renewal date is missing or invalid." });
    if (autoRenew === null) issues.push({ severity: "CRITICAL", context, message: `Auto-renew value ${JSON.stringify(record.auto)} is not recognized.` });
    if (!status) issues.push({ severity: "CRITICAL", context, message: "Subscription active/archived status is ambiguous." });
    if (!Array.isArray(record.payments)) issues.push({ severity: "CRITICAL", context, message: "Subscription payments must be an array." });
    const recordHasCritical = issues.some((issue) => issue.severity === "CRITICAL" && issue.context === context);
    if (recordHasCritical || !oldId || !name || !category || notes === null || costOre === null || !billingPeriod || !nextPaymentDate || autoRenew === null || !status) continue;
    const id = deterministicIds(oldId, "subscription");
    subscriptions.push({ id, oldId, name, costOre, category, billingPeriod, nextPaymentDate, autoRenew, status, notes });

    for (const [paymentIndex, payment] of record.payments.entries()) {
      const paymentFallbackContext = `subscription ${oldId} payment[${paymentIndex}]`;
      if (!isRecord(payment)) {
        issues.push({ severity: "CRITICAL", context: paymentFallbackContext, message: "Subscription payment must be an object." });
        continue;
      }
      const oldPaymentId = legacyId(payment.id);
      const paymentContext = oldPaymentId ? `subscription payment ${oldPaymentId}` : paymentFallbackContext;
      if (!oldPaymentId) issues.push({ severity: "CRITICAL", context: paymentContext, message: "Subscription payment id is missing or unsafe." });
      if (oldPaymentId && paymentIds.has(oldPaymentId)) issues.push({ severity: "CRITICAL", context: paymentContext, message: "Duplicate subscription payment id." });
      if (oldPaymentId) paymentIds.add(oldPaymentId);
      const amountOre = moneyField(payment.amount, issues, paymentContext, "amount");
      const occurredAt = validDate(payment.date) ? payment.date : null;
      if (!occurredAt) issues.push({ severity: "CRITICAL", context: paymentContext, message: "Subscription payment date is missing or invalid." });
      if (amountOre !== null && payment.rawAmount !== undefined && payment.currency === "DKK") {
        compareOre(amountOre, dkkToOre(payment.rawAmount), issues, paymentContext, "rawAmount does not reconcile with the DKK subscription payment");
      }
      const paymentHasCritical = issues.some((issue) => issue.severity === "CRITICAL" && issue.context === paymentContext);
      if (paymentHasCritical || !oldPaymentId || amountOre === null || !occurredAt) continue;
      subscriptionPayments.push({
        id: deterministicIds(oldPaymentId, "subscription-payment"), oldId: oldPaymentId,
        subscriptionId: id, subscriptionOldId: oldId, amountOre, occurredAt, notes: "",
      });
    }
  }

  const summary = summarize(products, purchases, sales, expenses, subscriptions, subscriptionPayments);
  const ignored = {
    revolutEntries: Array.isArray(data.revolut) ? data.revolut.length : 0,
    vatSettlements: Array.isArray(data.vatSettlements) ? data.vatSettlements.length : 0,
    listings: Array.isArray(data.listings) ? data.listings.length : 0,
    notifications: Array.isArray(data.notifications) ? data.notifications.length : 0,
    embeddedVatAndAccountMetadata: true,
  };
  return { sourceName, sourceSha256, importId, products, purchases, sales, expenses, subscriptions, subscriptionPayments, issues, ignored, summary, canApply: !issues.some((issue) => issue.severity === "CRITICAL") };
}

function emptySummary() {
  return {
    productsFound: 0, purchasesToCreate: 0, salesToCreate: 0, unitsPurchased: 0, unitsSold: 0,
    remainingInventory: 0, purchaseCostOre: 0, revenueOre: 0, costBasisOre: 0, feesOre: 0,
    shippingOre: 0, otherSalesCostsOre: 0, totalSalesCostsOre: 0, tradingProfitOre: 0,
    expensesToCreate: 0, subscriptionsToCreate: 0, subscriptionPaymentsToCreate: 0,
    ordinaryExpensesOre: 0, subscriptionExpensesOre: 0, operatingExpensesOre: 0, netProfitOre: 0,
  };
}

function summarize(products, purchases, sales, expenses, subscriptions, subscriptionPayments) {
  const tradingProfitOre = sales.reduce((sum, row) => sum + row.netProfitOre, 0);
  const ordinaryExpensesOre = expenses.reduce((sum, row) => sum + row.amountOre, 0);
  const subscriptionExpensesOre = subscriptionPayments.reduce((sum, row) => sum + row.amountOre, 0);
  const operatingExpensesOre = ordinaryExpensesOre + subscriptionExpensesOre;
  return {
    productsFound: products.length,
    purchasesToCreate: purchases.length,
    salesToCreate: sales.length,
    unitsPurchased: purchases.reduce((sum, row) => sum + row.quantity, 0),
    unitsSold: sales.reduce((sum, row) => sum + row.quantity, 0),
    remainingInventory: products.reduce((sum, row) => sum + row.oldRemainingQuantity, 0),
    purchaseCostOre: purchases.reduce((sum, row) => sum + row.totalCostsOre, 0),
    revenueOre: sales.reduce((sum, row) => sum + row.revenueOre, 0),
    costBasisOre: sales.reduce((sum, row) => sum + row.costBasisOre, 0),
    feesOre: sales.reduce((sum, row) => sum + row.feeOre + row.promotedFeeOre, 0),
    shippingOre: sales.reduce((sum, row) => sum + row.shippingOre, 0),
    otherSalesCostsOre: sales.reduce((sum, row) => sum + row.otherCostsOre, 0),
    totalSalesCostsOre: sales.reduce((sum, row) => sum + row.feeOre + row.promotedFeeOre + row.shippingOre + row.otherCostsOre, 0),
    tradingProfitOre,
    expensesToCreate: expenses.length,
    subscriptionsToCreate: subscriptions.length,
    subscriptionPaymentsToCreate: subscriptionPayments.length,
    ordinaryExpensesOre,
    subscriptionExpensesOre,
    operatingExpensesOre,
    netProfitOre: tradingProfitOre - operatingExpensesOre,
  };
}

function sqlText(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlNullableText(value) {
  return value ? sqlText(value) : "NULL";
}

function sqlNullableNumber(value) {
  return value === null || value === undefined ? "NULL" : String(value);
}

export function buildImportSql(analysis) {
  if (!analysis.canApply) throw new Error("Cannot build import SQL while critical validation issues exist.");
  const summaryJson = JSON.stringify(analysis.summary);
  const lines = [
    `-- Reverlo ResellTrack one-off import: ${analysis.sourceSha256}`,
    "PRAGMA foreign_keys = ON;",
    `INSERT INTO tracker_imports (id, source, source_sha256, product_count, purchase_count, sale_count, units_purchased, units_sold, summary_json) VALUES (${sqlText(analysis.importId)}, ${sqlText(analysis.sourceName)}, ${sqlText(analysis.sourceSha256)}, ${analysis.summary.productsFound}, ${analysis.summary.purchasesToCreate}, ${analysis.summary.salesToCreate}, ${analysis.summary.unitsPurchased}, ${analysis.summary.unitsSold}, ${sqlText(summaryJson)});`,
  ];
  for (const product of analysis.products) {
    lines.push(`INSERT INTO tracker_products (id, name, quantity, remaining_quantity, purchase_price_ore, purchase_shipping_ore, expected_sale_price_ore, listing_price_ore, supplier, purchase_date, status, notes) VALUES (${sqlText(product.id)}, ${sqlText(product.name)}, ${product.quantity}, ${product.oldRemainingQuantity}, ${product.purchasePriceOre}, ${product.purchaseShippingOre}, NULL, NULL, ${sqlText(product.supplier)}, ${sqlText(product.purchaseDate)}, ${sqlText(product.status)}, ${sqlText(product.notes)});`);
  }
  for (const purchase of analysis.purchases) {
    const vat = purchase.vat;
    lines.push(`INSERT INTO tracker_transactions (id, product_id, type, quantity, unit_price_ore, shipping_ore, supplier, platform, fee_ore, promoted_fee_ore, other_costs_ore, cost_basis_ore, revenue_ore, total_costs_ore, net_profit_ore, notes, entered_unit_price_ore, entered_shipping_ore, price_mode, vat_treatment, vat_rate_bps, gross_amount_ore, input_vat_ore, output_vat_ore, deductible_vat_ore, supplier_country, occurred_at) VALUES (${sqlText(purchase.id)}, ${sqlText(purchase.productId)}, 'PURCHASE', ${purchase.quantity}, ${purchase.unitPriceOre}, ${purchase.shippingOre}, ${sqlNullableText(purchase.supplier)}, NULL, 0, 0, 0, ${purchase.costBasisOre}, 0, ${purchase.totalCostsOre}, 0, ${sqlText(purchase.notes)}, ${sqlNullableNumber(vat?.enteredUnitPriceOre)}, ${sqlNullableNumber(vat?.enteredShippingOre)}, ${sqlNullableText(vat?.priceMode)}, ${sqlNullableText(vat?.vatTreatment)}, ${sqlNullableNumber(vat?.vatRateBps)}, ${sqlNullableNumber(vat?.grossAmountOre)}, ${sqlNullableNumber(vat?.inputVatOre)}, ${sqlNullableNumber(vat?.outputVatOre)}, ${sqlNullableNumber(vat?.deductibleVatOre)}, ${sqlNullableText(vat?.supplierCountry)}, ${sqlText(purchase.occurredAt)});`);
  }
  for (const sale of analysis.sales) {
    const vat = sale.vat;
    lines.push(`INSERT INTO tracker_transactions (id, product_id, type, quantity, unit_price_ore, shipping_ore, supplier, platform, fee_ore, promoted_fee_ore, other_costs_ore, cost_basis_ore, revenue_ore, total_costs_ore, net_profit_ore, notes, entered_unit_price_ore, entered_shipping_ore, entered_total_price_ore, price_mode, vat_treatment, vat_rate_bps, gross_amount_ore, input_vat_ore, output_vat_ore, deductible_vat_ore, customer_country, is_b2b, vat_id_reference, occurred_at) VALUES (${sqlText(sale.id)}, ${sqlText(sale.productId)}, 'SALE', ${sale.quantity}, ${sale.unitPriceOre}, ${sale.shippingOre}, NULL, ${sqlText(sale.platform)}, ${sale.feeOre}, ${sale.promotedFeeOre}, ${sale.otherCostsOre}, ${sale.costBasisOre}, ${sale.revenueOre}, ${sale.totalCostsOre}, ${sale.netProfitOre}, ${sqlText(sale.notes)}, ${sqlNullableNumber(vat?.enteredUnitPriceOre)}, ${sqlNullableNumber(vat?.enteredShippingOre)}, ${sqlNullableNumber(vat?.enteredTotalPriceOre)}, ${sqlNullableText(vat?.priceMode)}, ${sqlNullableText(vat?.vatTreatment)}, ${sqlNullableNumber(vat?.vatRateBps)}, ${sqlNullableNumber(vat?.grossAmountOre)}, ${sqlNullableNumber(vat?.inputVatOre)}, ${sqlNullableNumber(vat?.outputVatOre)}, ${sqlNullableNumber(vat?.deductibleVatOre)}, ${sqlNullableText(vat?.customerCountry)}, ${vat ? vat.isB2b ? 1 : 0 : "NULL"}, ${sqlNullableText(vat?.vatIdReference)}, ${sqlText(sale.occurredAt)});`);
  }
  for (const expense of analysis.expenses) {
    lines.push(`INSERT INTO tracker_expenses (id, name, amount_ore, category, occurred_at, notes) VALUES (${sqlText(expense.id)}, ${sqlText(expense.name)}, ${expense.amountOre}, ${sqlText(expense.category)}, ${sqlText(expense.occurredAt)}, ${sqlText(expense.notes)});`);
  }
  for (const subscription of analysis.subscriptions) {
    lines.push(`INSERT INTO tracker_subscriptions (id, name, cost_ore, category, billing_period, next_payment_date, auto_renew, status, notes) VALUES (${sqlText(subscription.id)}, ${sqlText(subscription.name)}, ${subscription.costOre}, ${sqlText(subscription.category)}, ${sqlText(subscription.billingPeriod)}, ${sqlText(subscription.nextPaymentDate)}, ${subscription.autoRenew ? 1 : 0}, ${sqlText(subscription.status)}, ${sqlText(subscription.notes)});`);
  }
  for (const payment of analysis.subscriptionPayments) {
    lines.push(`INSERT INTO tracker_subscription_payments (id, subscription_id, amount_ore, occurred_at, notes) VALUES (${sqlText(payment.id)}, ${sqlText(payment.subscriptionId)}, ${payment.amountOre}, ${sqlText(payment.occurredAt)}, ${sqlText(payment.notes)});`);
  }
  return `${lines.join("\n")}\n`;
}

export function formatDkk(ore) {
  return new Intl.NumberFormat("da-DK", { style: "currency", currency: "DKK" }).format(ore / 100);
}

export function renderReport(analysis, dryRun = true) {
  const { summary } = analysis;
  const critical = analysis.issues.filter((issue) => issue.severity === "CRITICAL");
  const warnings = analysis.issues.filter((issue) => issue.severity === "WARNING");
  const lines = [
    dryRun ? "DRY RUN — no D1 writes" : "IMPORT VALIDATION",
    `Source: ${analysis.sourceName}`,
    `Canonical SHA-256: ${analysis.sourceSha256}`,
    "",
    `Products found: ${summary.productsFound}`,
    `Purchases to create: ${summary.purchasesToCreate}`,
    `Sales to create: ${summary.salesToCreate}`,
    `Units purchased: ${summary.unitsPurchased}`,
    `Units sold: ${summary.unitsSold}`,
    `Remaining inventory: ${summary.remainingInventory}`,
    `Purchase cost: ${formatDkk(summary.purchaseCostOre)}`,
    `Revenue: ${formatDkk(summary.revenueOre)}`,
    `Sold cost basis: ${formatDkk(summary.costBasisOre)}`,
    `Fees: ${formatDkk(summary.feesOre)}`,
    `Sale shipping: ${formatDkk(summary.shippingOre)}`,
    `Other sale costs: ${formatDkk(summary.otherSalesCostsOre)}`,
    `Fees + shipping + other sale costs: ${formatDkk(summary.totalSalesCostsOre)}`,
    `Trading profit: ${formatDkk(summary.tradingProfitOre)}`,
    "",
    `Expenses to create: ${summary.expensesToCreate}`,
    `Subscriptions to create: ${summary.subscriptionsToCreate}`,
    `Subscription payments to create: ${summary.subscriptionPaymentsToCreate}`,
    `Ordinary expenses: ${formatDkk(summary.ordinaryExpensesOre)}`,
    `Subscription expenses (recorded payments only): ${formatDkk(summary.subscriptionExpensesOre)}`,
    `Operating expenses: ${formatDkk(summary.operatingExpensesOre)}`,
    `Net profit after operating expenses: ${formatDkk(summary.netProfitOre)}`,
    "",
    `Critical issues: ${critical.length}`,
    `Warnings: ${warnings.length}`,
  ];
  for (const issue of analysis.issues) lines.push(`[${issue.severity}] ${issue.context}: ${issue.message}`);
  lines.push("", `Result: ${analysis.canApply ? "VALID — eligible for an explicit apply" : "REJECTED — production import is blocked"}`);
  return lines.join("\n");
}

function parseArgs(argv) {
  const options = { apply: false, remote: false, local: false, confirm: "", database: "reverlo-db", file: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") options.apply = true;
    else if (arg === "--remote") options.remote = true;
    else if (arg === "--local") options.local = true;
    else if (arg === "--confirm") options.confirm = argv[++index] ?? "";
    else if (arg === "--database") options.database = argv[++index] ?? "";
    else if (arg.startsWith("--")) throw new Error(`Unknown option: ${arg}`);
    else if (options.file) throw new Error("Provide exactly one JSON file.");
    else options.file = arg;
  }
  if (!options.file) throw new Error("Usage: npm run tracker:import -- <file.json> [--apply (--local|--remote) --confirm <sha256>]");
  if (options.remote && options.local) throw new Error("Choose either --local or --remote, not both.");
  if (!options.apply && (options.remote || options.local || options.confirm)) throw new Error("Target and confirmation flags are only valid with --apply.");
  if (options.apply && !options.remote && !options.local) throw new Error("--apply requires an explicit --local or --remote target.");
  if (options.apply && !options.database) throw new Error("A D1 database name is required.");
  return options;
}

async function runCli() {
  const options = parseArgs(process.argv.slice(2));
  const raw = await readFile(options.file, "utf8");
  const data = JSON.parse(raw);
  const analysis = analyseResellTrack(data, basename(options.file));
  console.log(renderReport(analysis, !options.apply));
  console.log("\nIgnored in this version:", JSON.stringify(analysis.ignored));
  if (!options.apply) return;
  if (!analysis.canApply) throw new Error("Import refused because critical validation issues exist.");
  if (options.confirm !== analysis.sourceSha256) {
    throw new Error(`Import refused. Pass --confirm ${analysis.sourceSha256} to acknowledge this exact canonical JSON payload.`);
  }

  const tempDirectory = await mkdtemp(join(tmpdir(), "reverlo-reselltrack-import-"));
  const sqlPath = join(tempDirectory, "import.sql");
  try {
    await writeFile(sqlPath, buildImportSql(analysis), { encoding: "utf8", mode: 0o600 });
    const executable = process.platform === "win32" ? "npx.cmd" : "npx";
    const args = ["wrangler", "d1", "execute", options.database, options.remote ? "--remote" : "--local", `--file=${sqlPath}`, "--yes"];
    const result = spawnSync(executable, args, { cwd: process.cwd(), stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Wrangler exited with status ${result.status}. D1 rejected or rolled back the import.`);
    console.log(`\nImport completed once for ${analysis.sourceSha256}. The ledger and deterministic record IDs prevent a duplicate import.`);
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

const entryPoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entryPoint) {
  runCli().catch((error) => {
    console.error(`\nImport failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
