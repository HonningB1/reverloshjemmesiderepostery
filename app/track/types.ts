export const trackerStatuses = ["IN_STOCK", "LISTED", "RESERVED", "SOLD"] as const;
export type TrackerStatus = (typeof trackerStatuses)[number];
export type TransactionType = "PURCHASE" | "SALE";
export type AnalyticsPeriod = "30D" | "90D" | "YTD" | "ALL";
export const priceModes = ["VAT_EXCLUSIVE", "VAT_INCLUSIVE"] as const;
export type PriceMode = (typeof priceModes)[number];
export const vatTreatments = [
  "DANISH_PURCHASE_DEDUCTIBLE",
  "DANISH_SALE_VAT",
  "EU_B2B_SALE_REVERSE_CHARGE",
  "EU_PURCHASE_REVERSE_CHARGE",
  "PRIVATE_PURCHASE_NO_DEDUCTION",
  "NO_VAT_OUTSIDE_SCOPE",
  "CUSTOM_MANUAL",
] as const;
export type VatTreatment = (typeof vatTreatments)[number];
export type VatSettlementDirection = "PAID" | "RECEIVED";
export const billingPeriods = ["WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY", "CUSTOM"] as const;
export type BillingPeriod = (typeof billingPeriods)[number];
export type SubscriptionStatus = "ACTIVE" | "ARCHIVED";

export type TrackerProduct = {
  id: string;
  name: string;
  quantity: number;
  remainingQuantity: number;
  purchasePriceOre: number;
  purchaseShippingOre: number;
  expectedSalePriceOre: number | null;
  listingPriceOre: number | null;
  supplier: string;
  purchaseDate: string;
  status: TrackerStatus;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type TrackerTransaction = {
  id: string;
  productId: string;
  productName: string;
  type: TransactionType;
  quantity: number;
  unitPriceOre: number;
  shippingOre: number;
  supplier: string | null;
  platform: string | null;
  feeOre: number;
  promotedFeeOre: number;
  otherCostsOre: number;
  costBasisOre: number;
  revenueOre: number;
  totalCostsOre: number;
  netProfitOre: number;
  notes: string;
  enteredUnitPriceOre: number | null;
  enteredShippingOre: number | null;
  enteredTotalPriceOre: number | null;
  priceMode: PriceMode | null;
  vatTreatment: VatTreatment | null;
  vatRateBps: number | null;
  grossAmountOre: number | null;
  inputVatOre: number | null;
  outputVatOre: number | null;
  deductibleVatOre: number | null;
  supplierCountry: string | null;
  customerCountry: string | null;
  isB2b: boolean | number | null;
  vatIdReference: string | null;
  occurredAt: string;
  createdAt: string;
  updatedAt: string | null;
};

export type TrackerVatSettlement = {
  id: string;
  direction: VatSettlementDirection;
  amountOre: number;
  occurredAt: string;
  reference: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type VatData = {
  totals: {
    inputVatOre: number;
    deductibleInputVatOre: number;
    outputVatOre: number;
    paidSettlementsOre: number;
    receivedSettlementsOre: number;
    openPositionOre: number;
    receivableOre: number;
    payableOre: number;
  };
  settlements: TrackerVatSettlement[];
};

export type ProfitPoint = {
  date: string;
  tradingProfitOre: number;
  operatingExpensesOre: number;
  netProfitOre: number;
  revenueOre: number;
  tradingCostsOre: number;
};

export type TrackerActivity = {
  id: string;
  kind: "PURCHASE" | "SALE" | "EXPENSE" | "SUBSCRIPTION_PAYMENT";
  title: string;
  quantity: number | null;
  context: string;
  amountOre: number;
  occurredAt: string;
};

export type OverviewData = {
  metrics: {
    tradingProfitOre: number;
    operatingExpensesOre: number;
    netProfitOre: number;
    revenueOre: number;
    inventoryValueOre: number;
    cashInvestedOre: number;
  };
  profitSeries: ProfitPoint[];
  recentActivity: TrackerActivity[];
  inventorySnapshot: TrackerProduct[];
  statusCounts: Record<TrackerStatus, number>;
};

export type ProductPerformance = {
  productName: string;
  unitsSold: number;
  revenueOre: number;
  costBasisOre: number;
  costsOre: number;
  profitOre: number;
};

export type AnalyticsData = {
  period: AnalyticsPeriod;
  totals: {
    unitsSold: number;
    revenueOre: number;
    costBasisOre: number;
    tradingCostsOre: number;
    tradingProfitOre: number;
    operatingExpensesOre: number;
    netProfitOre: number;
  };
  series: ProfitPoint[];
  products: ProductPerformance[];
};

export type TrackerExpense = {
  id: string;
  name: string;
  amountOre: number;
  category: string;
  occurredAt: string;
  notes: string;
  sourceType: "SUBSCRIPTION_PAYMENT" | null;
  sourceId: string | null;
  sourceDetails: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TrackerSubscription = {
  id: string;
  name: string;
  costOre: number;
  category: string;
  billingPeriod: BillingPeriod;
  nextPaymentDate: string;
  autoRenew: boolean | number;
  status: SubscriptionStatus;
  notes: string;
  createdAt: string;
  updatedAt: string;
  paidTotalOre: number;
  paymentCount: number;
};

export type TrackerSubscriptionPayment = {
  id: string;
  subscriptionId: string;
  subscriptionName: string;
  amountOre: number;
  occurredAt: string;
  notes: string;
  createdAt: string;
};

export type ExpensesData = {
  expenses: TrackerExpense[];
  subscriptions: TrackerSubscription[];
  payments: TrackerSubscriptionPayment[];
  totals: {
    ordinaryExpensesOre: number;
    subscriptionExpensesOre: number;
    operatingExpensesOre: number;
    activeSubscriptions: number;
  };
};

export type EmailImportStatus = "RECEIVED" | "PROCESSING" | "NEEDS_REVIEW" | "READY" | "IMPORTED" | "DUPLICATE" | "REJECTED" | "FAILED";
export type TrackerEmailImportItem = { id: string; emailImportId: string; position: number; parsed: Record<string, unknown>; importedProductId: string | null; importedTransactionId: string | null };
export type TrackerEmailImport = {
  id: string; status: EmailImportStatus; messageId: string | null; originalSender: string; forwardedBy: string; recipient: string; subject: string;
  originalSubject: string; emailDate: string | null; receivedAt: string; textBody: string; htmlBody: string; attachments: Array<{ name: string; contentType: string; size: number | null; sha256?: string | null; text?: string; extractionStatus?: string; issue?: string | null; pages?: number | null }>;
  parsed: { supplier: string | null; supplierSource: string | null; originalSenderName?: string | null; originalSenderEmail?: string | null; originalSubject?: string | null; orderNumber: string | null; orderNumberSource?: string | null; invoiceNumber?: string | null; invoiceNumberSource?: string | null; purchaseDate: string | null; purchaseDateSource?: string | null; currency: string | null;
    subtotal: { minor: number; currency: string } | null; shipping: { minor: number; currency: string } | null; discount: { minor: number; currency: string } | null;
    total: { minor: number; currency: string } | null; vatAmount: { minor: number; currency: string } | null; vatRateBps: number | null; issues: string[]; conflicts?: string[]; documents?: Array<{ name: string; extractionStatus: string }>; textPreview: string };
  review: { supplier: string; purchaseDate: string; fxRate: string; orderNumber?: string; invoiceNumber?: string; currency?: string; documentTotals?: Record<string, string>; items: Array<{ sourceItemId?: string | null; name: string; quantity: number; unitPriceOre: number | null; shippingOre: number | null;
    supplierCountry: string; priceMode: string; vatTreatment: string; vatRateBps: number | null; inputVatOre: number | null; outputVatOre: number | null; deductibleVatOre: number | null }> };
  items: TrackerEmailImportItem[]; errorCode: string | null; importedAt: string | null; createdAt: string; updatedAt: string;
};
