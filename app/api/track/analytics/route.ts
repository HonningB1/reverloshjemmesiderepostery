import { noStoreJson, trackerDb, trackerError, trackerUnavailable } from "../../../../lib/tracker";
import { analyticsDateRange, calendarDateInTimeZone } from "../../../../lib/tracker-accounting";
import { operationalSalesById, type OperationalProduct, type OperationalSale } from "../../../../lib/tracker-operational";
import type { AnalyticsPeriod, ProductPerformance, ProfitPoint } from "../../../track/types";

const periods = ["30D", "90D", "YTD", "ALL"] as const;
type OperatingRow = { date: string; amountOre: number };
type SaleRow = OperationalSale & { productName: string };

const productSelect = `id, quantity, purchase_price_ore AS purchasePriceOre, purchase_shipping_ore AS purchaseShippingOre,
  COALESCE((SELECT CASE WHEN purchase.transaction_context = 'PRIVATE' THEN COALESCE(purchase.entered_unit_price_ore, purchase.unit_price_ore) END
    FROM tracker_transactions purchase WHERE purchase.product_id = tracker_products.id AND purchase.type = 'PURCHASE' LIMIT 1), purchase_price_ore) AS operationalPurchasePriceOre,
  COALESCE((SELECT CASE WHEN purchase.transaction_context = 'PRIVATE' THEN COALESCE(purchase.entered_shipping_ore, purchase.shipping_ore) END
    FROM tracker_transactions purchase WHERE purchase.product_id = tracker_products.id AND purchase.type = 'PURCHASE' LIMIT 1), purchase_shipping_ore`;

export async function GET(request: Request) {
  const db = trackerDb();
  if (!db) return trackerUnavailable();
  const requested = new URL(request.url).searchParams.get("period") ?? "30D";
  const period: AnalyticsPeriod = periods.includes(requested as AnalyticsPeriod) ? requested as AnalyticsPeriod : "30D";
  const { since, through } = analyticsDateRange(period, calendarDateInTimeZone(new Date()));
  const inPeriod = (date: string) => !since || date >= since && date <= through!;
  try {
    const [products, sales, operating] = await Promise.all([
      db.prepare(`SELECT ${productSelect} FROM tracker_products`).all<OperationalProduct>(),
      db.prepare(`SELECT t.id, t.product_id AS productId, p.name AS productName, t.quantity,
        t.revenue_ore AS revenueOre, t.fee_ore AS feeOre, t.promoted_fee_ore AS promotedFeeOre,
        t.shipping_ore AS shippingOre, t.other_costs_ore AS otherCostsOre, t.gross_amount_ore AS grossRevenueOre,
        t.transaction_context AS transactionContext, t.occurred_at AS occurredAt, t.created_at AS createdAt
        FROM tracker_transactions t JOIN tracker_products p ON p.id = t.product_id WHERE t.type = 'SALE'`).all<SaleRow>(),
      db.prepare(`SELECT occurred_at AS date, amount_ore AS amountOre FROM tracker_expenses
        UNION ALL SELECT occurred_at AS date,
          CASE WHEN transaction_context = 'PRIVATE' THEN COALESCE(entered_amount_ore, gross_amount_ore, amount_ore) ELSE amount_ore END
          AS amountOre FROM tracker_subscription_payments`).all<OperatingRow>(),
    ]);
    const operational = operationalSalesById(products.results, sales.results);
    const selectedSales = sales.results.filter((sale) => inPeriod(sale.occurredAt));
    const selectedOperating = operating.results.filter((entry) => inPeriod(entry.date));
    const daily = new Map<string, ProfitPoint>();
    const point = (date: string) => {
      const existing = daily.get(date) ?? { date, tradingProfitOre: 0, operatingExpensesOre: 0, netProfitOre: 0, revenueOre: 0, tradingCostsOre: 0 };
      daily.set(date, existing); return existing;
    };
    const productTotals = new Map<string, ProductPerformance>();
    for (const sale of selectedSales) {
      const result = operational.get(sale.id); if (!result) continue;
      const current = point(sale.occurredAt); current.tradingProfitOre += result.operationalProfitOre;
      current.revenueOre += result.operationalRevenueOre; current.tradingCostsOre += result.operationalTotalCostsOre;
      const product = productTotals.get(sale.productName) ?? { productName: sale.productName, unitsSold: 0, revenueOre: 0, costBasisOre: 0, costsOre: 0, profitOre: 0 };
      product.unitsSold += sale.quantity; product.revenueOre += result.operationalRevenueOre;
      product.costBasisOre += result.operationalCostBasisOre; product.costsOre += result.operationalTotalCostsOre;
      product.profitOre += result.operationalProfitOre; productTotals.set(sale.productName, product);
    }
    for (const expense of selectedOperating) point(expense.date).operatingExpensesOre += Number(expense.amountOre);
    const series = [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)).map((entry) => ({ ...entry,
      netProfitOre: entry.tradingProfitOre - entry.operatingExpensesOre }));
    const totals = [...productTotals.values()].reduce((sum, product) => ({
      unitsSold: sum.unitsSold + product.unitsSold, revenueOre: sum.revenueOre + product.revenueOre,
      costBasisOre: sum.costBasisOre + product.costBasisOre, tradingCostsOre: sum.tradingCostsOre + product.costsOre,
      tradingProfitOre: sum.tradingProfitOre + product.profitOre,
    }), { unitsSold: 0, revenueOre: 0, costBasisOre: 0, tradingCostsOre: 0, tradingProfitOre: 0 });
    const tradingProfitOre = totals.tradingProfitOre;
    const operatingExpensesOre = selectedOperating.reduce((sum, row) => sum + Number(row.amountOre), 0);
    return noStoreJson({ period, totals: { ...totals, operatingExpensesOre,
      netProfitOre: tradingProfitOre - operatingExpensesOre }, series,
      products: [...productTotals.values()].sort((a, b) => b.profitOre - a.profitOre || b.revenueOre - a.revenueOre) });
  } catch (error) {
    return trackerError(error, "Unable to load analytics.");
  }
}
