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

type TotalsRow = { unitsSold: number; revenueOre: number; costBasisOre: number; costsOre: number; profitOre: number };

export async function GET(request: Request) {
  const db = trackerDb();
  if (!db) return trackerUnavailable();
  const requested = new URL(request.url).searchParams.get("period") ?? "30D";
  const period: AnalyticsPeriod = periods.includes(requested as AnalyticsPeriod) ? requested as AnalyticsPeriod : "30D";
  const since = startDate(period);
  const predicate = since ? " AND t.occurred_at >= ?" : "";
  try {
    const totalsStatement = db.prepare(`SELECT COALESCE(SUM(t.quantity), 0) AS unitsSold,
      COALESCE(SUM(t.revenue_ore), 0) AS revenueOre, COALESCE(SUM(t.total_costs_ore), 0) AS costsOre,
      COALESCE(SUM(t.cost_basis_ore), 0) AS costBasisOre, COALESCE(SUM(t.net_profit_ore), 0) AS profitOre
      FROM tracker_transactions t WHERE t.type = 'SALE'${predicate}`);
    const seriesStatement = db.prepare(`SELECT t.occurred_at AS date, SUM(t.net_profit_ore) AS profitOre,
      SUM(t.revenue_ore) AS revenueOre, SUM(t.total_costs_ore) AS costsOre
      FROM tracker_transactions t WHERE t.type = 'SALE'${predicate}
      GROUP BY t.occurred_at ORDER BY t.occurred_at ASC`);
    const productsStatement = db.prepare(`SELECT p.name AS productName, SUM(t.quantity) AS unitsSold,
      SUM(t.revenue_ore) AS revenueOre, SUM(t.cost_basis_ore) AS costBasisOre,
      SUM(t.total_costs_ore) AS costsOre, SUM(t.net_profit_ore) AS profitOre
      FROM tracker_transactions t JOIN tracker_products p ON p.id = t.product_id
      WHERE t.type = 'SALE'${predicate} GROUP BY p.name ORDER BY profitOre DESC, revenueOre DESC`);
    const [totals, series, products] = await Promise.all([
      (since ? totalsStatement.bind(since) : totalsStatement).first<TotalsRow>(),
      (since ? seriesStatement.bind(since) : seriesStatement).all<ProfitPoint>(),
      (since ? productsStatement.bind(since) : productsStatement).all<ProductPerformance>(),
    ]);
    return noStoreJson({
      period,
      totals: {
        unitsSold: Number(totals?.unitsSold ?? 0), revenueOre: Number(totals?.revenueOre ?? 0),
        costBasisOre: Number(totals?.costBasisOre ?? 0), costsOre: Number(totals?.costsOre ?? 0),
        profitOre: Number(totals?.profitOre ?? 0),
      },
      series: series.results,
      products: products.results,
    });
  } catch (error) {
    return trackerError(error, "Unable to load analytics.");
  }
}
