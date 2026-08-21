import { noStoreJson, trackerDb, trackerError, trackerUnavailable } from "../../../../lib/tracker";
import type { AnalyticsPeriod, ProductPerformance, ProfitPoint } from "../../../track/types";

const periods = ["30D", "90D", "YTD", "ALL"] as const;

function startDate(period: AnalyticsPeriod) {
  const today = new Date();
  if (period === "ALL") return null;
  if (period === "YTD") return `${today.getUTCFullYear()}-01-01`;
  const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  date.setUTCDate(date.getUTCDate() - (period === "30D" ? 29 : 89));
  return date.toISOString().slice(0, 10);
}

type TradingTotals = { unitsSold: number; revenueOre: number; costBasisOre: number; tradingCostsOre: number; tradingProfitOre: number };
type OperatingTotals = { operatingExpensesOre: number };

export async function GET(request: Request) {
  const db = trackerDb();
  if (!db) return trackerUnavailable();
  const requested = new URL(request.url).searchParams.get("period") ?? "30D";
  const period: AnalyticsPeriod = periods.includes(requested as AnalyticsPeriod) ? requested as AnalyticsPeriod : "30D";
  const since = startDate(period);
  const transactionPredicate = since ? " AND t.occurred_at >= ?" : "";
  const expensePredicate = since ? " WHERE occurred_at >= ?" : "";
  try {
    const tradingStatement = db.prepare(`SELECT COALESCE(SUM(t.quantity), 0) AS unitsSold,
      COALESCE(SUM(t.revenue_ore), 0) AS revenueOre, COALESCE(SUM(t.total_costs_ore), 0) AS tradingCostsOre,
      COALESCE(SUM(t.cost_basis_ore), 0) AS costBasisOre, COALESCE(SUM(t.net_profit_ore), 0) AS tradingProfitOre
      FROM tracker_transactions t WHERE t.type = 'SALE'${transactionPredicate}`);
    const operatingStatement = db.prepare(`SELECT
      (SELECT COALESCE(SUM(amount_ore), 0) FROM tracker_expenses${expensePredicate}) +
      (SELECT COALESCE(SUM(amount_ore), 0) FROM tracker_subscription_payments${expensePredicate}) AS operatingExpensesOre`);
    const seriesStatement = db.prepare(`WITH events AS (
      SELECT t.occurred_at AS date, t.net_profit_ore AS tradingProfitOre, 0 AS operatingExpensesOre,
        t.revenue_ore AS revenueOre, t.total_costs_ore AS tradingCostsOre
      FROM tracker_transactions t WHERE t.type = 'SALE'
      UNION ALL SELECT occurred_at, 0, amount_ore, 0, 0 FROM tracker_expenses
      UNION ALL SELECT occurred_at, 0, amount_ore, 0, 0 FROM tracker_subscription_payments
    ) SELECT date, SUM(tradingProfitOre) AS tradingProfitOre,
      SUM(operatingExpensesOre) AS operatingExpensesOre,
      SUM(tradingProfitOre) - SUM(operatingExpensesOre) AS netProfitOre,
      SUM(revenueOre) AS revenueOre, SUM(tradingCostsOre) AS tradingCostsOre
      FROM events${since ? " WHERE date >= ?" : ""} GROUP BY date ORDER BY date ASC`);
    const productsStatement = db.prepare(`SELECT p.name AS productName, SUM(t.quantity) AS unitsSold,
      SUM(t.revenue_ore) AS revenueOre, SUM(t.cost_basis_ore) AS costBasisOre,
      SUM(t.total_costs_ore) AS costsOre, SUM(t.net_profit_ore) AS profitOre
      FROM tracker_transactions t JOIN tracker_products p ON p.id = t.product_id
      WHERE t.type = 'SALE'${transactionPredicate} GROUP BY p.name ORDER BY profitOre DESC, revenueOre DESC`);

    const [trading, operating, series, products] = await Promise.all([
      (since ? tradingStatement.bind(since) : tradingStatement).first<TradingTotals>(),
      (since ? operatingStatement.bind(since, since) : operatingStatement).first<OperatingTotals>(),
      (since ? seriesStatement.bind(since) : seriesStatement).all<ProfitPoint>(),
      (since ? productsStatement.bind(since) : productsStatement).all<ProductPerformance>(),
    ]);
    const tradingProfitOre = Number(trading?.tradingProfitOre ?? 0);
    const operatingExpensesOre = Number(operating?.operatingExpensesOre ?? 0);
    return noStoreJson({
      period,
      totals: {
        unitsSold: Number(trading?.unitsSold ?? 0),
        revenueOre: Number(trading?.revenueOre ?? 0),
        costBasisOre: Number(trading?.costBasisOre ?? 0),
        tradingCostsOre: Number(trading?.tradingCostsOre ?? 0),
        tradingProfitOre,
        operatingExpensesOre,
        netProfitOre: tradingProfitOre - operatingExpensesOre,
      },
      series: series.results,
      products: products.results,
    });
  } catch (error) {
    return trackerError(error, "Unable to load analytics.");
  }
}
