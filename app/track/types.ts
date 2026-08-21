export const trackerStatuses = ["IN_STOCK", "LISTED", "RESERVED", "SOLD"] as const;
export type TrackerStatus = (typeof trackerStatuses)[number];
export type TransactionType = "PURCHASE" | "SALE";
export type AnalyticsPeriod = "30D" | "90D" | "YTD" | "ALL";

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

export type ProfitPoint = { date: string; profitOre: number; revenueOre: number; costsOre: number };

export type OverviewData = {
  metrics: { totalProfitOre: number; revenueOre: number; inventoryValueOre: number; cashInvestedOre: number };
  profitSeries: ProfitPoint[];
  recentActivity: TrackerTransaction[];
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
  totals: { unitsSold: number; revenueOre: number; costBasisOre: number; costsOre: number; profitOre: number };
  series: ProfitPoint[];
  products: ProductPerformance[];
};
