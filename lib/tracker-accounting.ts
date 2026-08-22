import type { PriceMode, TransactionType, VatTreatment } from "../app/track/types";

const MAX_MONEY_ORE = 100_000_000_000;

export type VatCalculationInput = {
  type: TransactionType;
  quantity: number;
  enteredUnitPriceOre: number;
  enteredShippingOre: number;
  enteredTotalPriceOre?: number | null;
  priceMode: PriceMode;
  vatTreatment: VatTreatment;
  vatRateBps: number;
  manualInputVatOre?: number | null;
  manualOutputVatOre?: number | null;
  manualDeductibleVatOre?: number | null;
};

export type VatCalculation = {
  unitPriceOre: number;
  shippingOre: number;
  revenueOre: number;
  economicPurchaseCostOre: number;
  grossAmountOre: number;
  inputVatOre: number;
  outputVatOre: number;
  deductibleVatOre: number;
};

function safeMoney(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_MONEY_ORE) {
    throw new Error(`${label} is outside the supported money range.`);
  }
  return value;
}

function multiplyMoney(value: number, quantity: number, label: string) {
  return safeMoney(value * quantity, label);
}

export function vatPartFromExclusive(netOre: number, rateBps: number) {
  return Number((BigInt(netOre) * BigInt(rateBps) + 5_000n) / 10_000n);
}

export function vatExclusiveFromInclusive(grossOre: number, rateBps: number) {
  if (rateBps === 0) return grossOre;
  return Number((BigInt(grossOre) * 10_000n + BigInt(10_000 + rateBps) / 2n) / BigInt(10_000 + rateBps));
}

function validateTreatment(type: TransactionType, treatment: VatTreatment) {
  const purchaseOnly = treatment === "DANISH_PURCHASE_DEDUCTIBLE" ||
    treatment === "EU_PURCHASE_REVERSE_CHARGE" ||
    treatment === "PRIVATE_PURCHASE_NO_DEDUCTION";
  const saleOnly = treatment === "DANISH_SALE_VAT" || treatment === "EU_B2B_SALE_REVERSE_CHARGE";
  if ((type === "PURCHASE" && saleOnly) || (type === "SALE" && purchaseOnly)) {
    throw new Error(`VAT treatment ${treatment} cannot be used for a ${type.toLowerCase()}.`);
  }
}

function manualMoney(value: number | null | undefined, label: string) {
  if (value === null || value === undefined) throw new Error(`${label} is required for custom VAT.`);
  return safeMoney(value, label);
}

function splitPurchaseCost(totalOre: number, enteredUnitOre: number, quantity: number, enteredShippingOre: number) {
  const enteredGoodsOre = multiplyMoney(enteredUnitOre, quantity, "Purchase goods total");
  const enteredTotalOre = safeMoney(enteredGoodsOre + enteredShippingOre, "Purchase total");
  if (enteredTotalOre === 0) return { unitPriceOre: 0, shippingOre: totalOre };

  const economicGoodsOre = Number((BigInt(totalOre) * BigInt(enteredGoodsOre)) / BigInt(enteredTotalOre));
  const unitPriceOre = Math.floor(economicGoodsOre / quantity);
  const shippingOre = totalOre - unitPriceOre * quantity;
  return { unitPriceOre, shippingOre };
}

export function calculateVatAmounts(input: VatCalculationInput): VatCalculation {
  const {
    type, quantity, enteredUnitPriceOre, enteredShippingOre, priceMode, vatTreatment, vatRateBps,
  } = input;
  if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 1_000_000) throw new Error("Quantity must be a positive whole number.");
  safeMoney(enteredUnitPriceOre, "Unit price");
  safeMoney(enteredShippingOre, "Shipping");
  if (!Number.isSafeInteger(vatRateBps) || vatRateBps < 0 || vatRateBps > 10_000) throw new Error("VAT rate must be between 0% and 100%.");
  validateTreatment(type, vatTreatment);
  if ((vatTreatment === "DANISH_PURCHASE_DEDUCTIBLE" || vatTreatment === "DANISH_SALE_VAT" ||
      vatTreatment === "EU_PURCHASE_REVERSE_CHARGE") && vatRateBps === 0) {
    throw new Error("The selected VAT treatment requires a positive VAT rate.");
  }
  if ((vatTreatment === "EU_B2B_SALE_REVERSE_CHARGE" || vatTreatment === "NO_VAT_OUTSIDE_SCOPE") && vatRateBps !== 0) {
    throw new Error("The selected VAT treatment requires a 0% VAT rate.");
  }

  const enteredGoodsOre = type === "SALE" && input.enteredTotalPriceOre !== null && input.enteredTotalPriceOre !== undefined
    ? safeMoney(input.enteredTotalPriceOre, "Sale total")
    : multiplyMoney(enteredUnitPriceOre, quantity, "Transaction goods total");
  const enteredTotalOre = safeMoney(enteredGoodsOre + (type === "PURCHASE" ? enteredShippingOre : 0), "Transaction total");
  const custom = vatTreatment === "CUSTOM_MANUAL";
  const noVat = vatTreatment === "NO_VAT_OUTSIDE_SCOPE" || vatTreatment === "EU_B2B_SALE_REVERSE_CHARGE";

  if (type === "SALE") {
    let revenueOre: number;
    let grossAmountOre: number;
    let outputVatOre: number;
    if (custom) {
      outputVatOre = manualMoney(input.manualOutputVatOre, "Output VAT");
      if (priceMode === "VAT_INCLUSIVE") {
        grossAmountOre = enteredGoodsOre;
        if (outputVatOre > grossAmountOre) throw new Error("Output VAT cannot exceed the VAT-inclusive sale total.");
        revenueOre = grossAmountOre - outputVatOre;
      } else {
        revenueOre = enteredGoodsOre;
        grossAmountOre = safeMoney(revenueOre + outputVatOre, "Gross sale total");
      }
    } else if (noVat) {
      revenueOre = enteredGoodsOre;
      grossAmountOre = enteredGoodsOre;
      outputVatOre = 0;
    } else if (priceMode === "VAT_INCLUSIVE") {
      grossAmountOre = enteredGoodsOre;
      revenueOre = vatExclusiveFromInclusive(grossAmountOre, vatRateBps);
      outputVatOre = grossAmountOre - revenueOre;
    } else {
      revenueOre = enteredGoodsOre;
      outputVatOre = vatPartFromExclusive(revenueOre, vatRateBps);
      grossAmountOre = safeMoney(revenueOre + outputVatOre, "Gross sale total");
    }
    return {
      unitPriceOre: Math.round(revenueOre / quantity),
      shippingOre: enteredShippingOre,
      revenueOre,
      economicPurchaseCostOre: 0,
      grossAmountOre,
      inputVatOre: 0,
      outputVatOre,
      deductibleVatOre: 0,
    };
  }

  let grossAmountOre: number;
  let exclusiveBaseOre: number;
  let inputVatOre: number;
  let outputVatOre = 0;
  let deductibleVatOre: number;

  if (custom) {
    inputVatOre = manualMoney(input.manualInputVatOre, "Input VAT");
    outputVatOre = manualMoney(input.manualOutputVatOre, "Output VAT");
    deductibleVatOre = manualMoney(input.manualDeductibleVatOre, "Deductible VAT");
    if (deductibleVatOre > inputVatOre) throw new Error("Deductible VAT cannot exceed input VAT.");
    if (priceMode === "VAT_INCLUSIVE") {
      grossAmountOre = enteredTotalOre;
      if (inputVatOre > grossAmountOre) throw new Error("Input VAT cannot exceed the VAT-inclusive purchase total.");
      exclusiveBaseOre = grossAmountOre - inputVatOre;
    } else {
      exclusiveBaseOre = enteredTotalOre;
      grossAmountOre = safeMoney(exclusiveBaseOre + inputVatOre, "Gross purchase total");
    }
  } else if (vatTreatment === "EU_PURCHASE_REVERSE_CHARGE") {
    exclusiveBaseOre = enteredTotalOre;
    grossAmountOre = enteredTotalOre;
    inputVatOre = vatPartFromExclusive(exclusiveBaseOre, vatRateBps);
    outputVatOre = inputVatOre;
    deductibleVatOre = inputVatOre;
  } else if (noVat) {
    exclusiveBaseOre = enteredTotalOre;
    grossAmountOre = enteredTotalOre;
    inputVatOre = 0;
    deductibleVatOre = 0;
  } else if (priceMode === "VAT_INCLUSIVE") {
    grossAmountOre = enteredTotalOre;
    exclusiveBaseOre = vatExclusiveFromInclusive(grossAmountOre, vatRateBps);
    inputVatOre = grossAmountOre - exclusiveBaseOre;
    deductibleVatOre = vatTreatment === "DANISH_PURCHASE_DEDUCTIBLE" ? inputVatOre : 0;
  } else {
    exclusiveBaseOre = enteredTotalOre;
    inputVatOre = vatPartFromExclusive(exclusiveBaseOre, vatRateBps);
    grossAmountOre = safeMoney(exclusiveBaseOre + inputVatOre, "Gross purchase total");
    deductibleVatOre = vatTreatment === "DANISH_PURCHASE_DEDUCTIBLE" ? inputVatOre : 0;
  }

  // Reverse-charge output VAT is a liability and offsets the simultaneous
  // deductible input VAT. It is therefore included before the deduction.
  const economicPurchaseCostOre = safeMoney(grossAmountOre + outputVatOre - deductibleVatOre, "Economic purchase cost");
  const split = splitPurchaseCost(economicPurchaseCostOre, enteredUnitPriceOre, quantity, enteredShippingOre);
  return {
    ...split,
    revenueOre: 0,
    economicPurchaseCostOre,
    grossAmountOre,
    inputVatOre,
    outputVatOre,
    deductibleVatOre,
  };
}

export type SaleLedgerInput = {
  id: string;
  quantity: number;
  revenueOre: number;
  feeOre: number;
  promotedFeeOre: number;
  shippingOre: number;
  otherCostsOre: number;
  occurredAt: string;
  createdAt?: string | null;
};

export type SaleLedgerResult = SaleLedgerInput & {
  costBasisOre: number;
  totalCostsOre: number;
  netProfitOre: number;
};

export function recalculateProductSales(
  product: { quantity: number; purchasePriceOre: number; purchaseShippingOre: number },
  sales: SaleLedgerInput[],
) {
  const sorted = [...sales].sort((a, b) =>
    a.occurredAt.localeCompare(b.occurredAt) ||
    (a.createdAt ?? "").localeCompare(b.createdAt ?? "") ||
    a.id.localeCompare(b.id));
  let soldBefore = 0;
  const updates: SaleLedgerResult[] = [];
  for (const sale of sorted) {
    if (!Number.isSafeInteger(sale.quantity) || sale.quantity <= 0) throw new Error("Every sale quantity must be a positive whole number.");
    if (soldBefore + sale.quantity > product.quantity) throw new Error("This change would sell more units than the product purchase contains.");
    const allocatedShippingOre = Number(
      (BigInt(product.purchaseShippingOre) * BigInt(soldBefore + sale.quantity)) / BigInt(product.quantity) -
      (BigInt(product.purchaseShippingOre) * BigInt(soldBefore)) / BigInt(product.quantity),
    );
    const costBasisOre = safeMoney(product.purchasePriceOre * sale.quantity + allocatedShippingOre, "Sale cost basis");
    const sellingCostsOre = safeMoney(sale.feeOre + sale.promotedFeeOre + sale.shippingOre + sale.otherCostsOre, "Sale costs");
    const totalCostsOre = safeMoney(costBasisOre + sellingCostsOre, "Sale total costs");
    updates.push({ ...sale, costBasisOre, totalCostsOre, netProfitOre: sale.revenueOre - totalCostsOre });
    soldBefore += sale.quantity;
  }
  return { remainingQuantity: product.quantity - soldBefore, sales: updates };
}

export function vatPosition(input: {
  deductibleInputVatOre: number;
  outputVatOre: number;
  paidSettlementsOre: number;
  receivedSettlementsOre: number;
}) {
  const openPositionOre = input.deductibleInputVatOre - input.outputVatOre + input.paidSettlementsOre - input.receivedSettlementsOre;
  return {
    openPositionOre,
    receivableOre: Math.max(openPositionOre, 0),
    payableOre: Math.max(-openPositionOre, 0),
  };
}
