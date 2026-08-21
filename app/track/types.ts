export const trackerStatuses = ["IN_STOCK", "LISTED", "RESERVED", "SOLD"] as const;
export type TrackerStatus = (typeof trackerStatuses)[number];
export type TransactionType = "PURCHASE" | "SALE";
export type AnalyticsPeriod = "30D" | "90D" | "YTD" | "ALL";
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
  occurredAt: string;
  createdAt: string;
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
  detail: string;
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
