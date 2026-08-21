"use client";

import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { ReverloWordmark } from "../components/ReverloWordmark";
import { ProfitChart } from "./ProfitChart";
import {
  trackerStatuses, type AnalyticsData, type AnalyticsPeriod, type OverviewData,
  type TrackerProduct, type TrackerStatus, type TrackerTransaction,
} from "./types";

type Section = "overview" | "inventory" | "transactions" | "analytics" | "calculator";
type TransactionFilter = "ALL" | "PURCHASE" | "SALE";
type DialogState =
  | { kind: "inventory"; product?: TrackerProduct }
  | { kind: "purchase" }
  | { kind: "sale" }
  | { kind: "delete"; product: TrackerProduct }
  | null;

const navigation: Array<{ id: Section; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "inventory", label: "Inventory" },
  { id: "transactions", label: "Transactions" },
  { id: "analytics", label: "Analytics" },
];

const emptyOverview: OverviewData = {
  metrics: { totalProfitOre: 0, revenueOre: 0, inventoryValueOre: 0, cashInvestedOre: 0 },
  profitSeries: [], recentActivity: [], inventorySnapshot: [],
  statusCounts: { IN_STOCK: 0, LISTED: 0, RESERVED: 0, SOLD: 0 },
};
const emptyAnalytics: AnalyticsData = {
  period: "30D", totals: { unitsSold: 0, revenueOre: 0, costBasisOre: 0, costsOre: 0, profitOre: 0 },
  series: [], products: [],
};

const moneyFormatter = new Intl.NumberFormat("da-DK", { style: "currency", currency: "DKK", minimumFractionDigits: 2 });
const compactMoneyFormatter = new Intl.NumberFormat("da-DK", { style: "currency", currency: "DKK", notation: "compact", maximumFractionDigits: 1 });
const dateFormatter = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" });

function formatMoney(ore: number) { return moneyFormatter.format(ore / 100); }
function formatCompactMoney(ore: number) { return Math.abs(ore) >= 100_000_00 ? compactMoneyFormatter.format(ore / 100) : formatMoney(ore); }
function formatDate(value: string) { const date = new Date(`${value}T00:00:00Z`); return Number.isNaN(date.getTime()) ? value : dateFormatter.format(date); }
function formatPercent(numerator: number, denominator: number) { return denominator ? `${((numerator / denominator) * 100).toFixed(1)}%` : "—"; }
function localDate() { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`; }

function dkkToOre(value: FormDataEntryValue | string | null) {
  const normalized = String(value ?? "").trim().replace(/\s/g, "").replace(",", ".");
  const match = normalized.match(/^(\d{1,10})(?:\.(\d{0,2}))?$/);
  if (!match) return null;
  const ore = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(ore) && ore <= 100_000_000_000 ? ore : null;
}

function percentToBps(value: string) {
  const normalized = value.trim().replace(",", ".");
  const match = normalized.match(/^(\d{1,3})(?:\.(\d{0,2}))?$/);
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

async function responseJson<T>(response: Response): Promise<T> {
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "The tracker request failed.");
  return payload;
}

function statusLabel(status: TrackerStatus) { return status.replace("_", " "); }
function statusClass(status: TrackerStatus) { return `track-status track-status-${status.toLowerCase().replace("_", "-")}`; }
function productTarget(product: TrackerProduct) { return product.listingPriceOre ?? product.expectedSalePriceOre; }
function remainingCost(product: TrackerProduct) {
  return product.purchasePriceOre * product.remainingQuantity + Math.floor((product.purchaseShippingOre * product.remainingQuantity) / product.quantity);
}
function potentialProfit(product: TrackerProduct) { const target = productTarget(product); return target === null ? null : target * product.remainingQuantity - remainingCost(product); }
function cumulativeSeries(series: OverviewData["profitSeries"] | AnalyticsData["series"]) {
  let running = 0;
  return series.map((point) => ({ date: point.date, value: (running += Number(point.profitOre)) }));
}

function Sidebar({ section, onNavigate }: { section: Section; onNavigate: (section: Section) => void }) {
  return <aside className="track-sidebar">
    <button className="track-brand" type="button" onClick={() => onNavigate("overview")} aria-label="Reverlo tracker overview"><ReverloWordmark /></button>
    <div className="track-private"><span /> Private workspace</div>
    <nav className="track-navigation" aria-label="Tracker navigation">{navigation.map((item, index) =>
      <button className={section === item.id ? "active" : ""} type="button" key={item.id} onClick={() => onNavigate(item.id)}><span>0{index + 1}</span>{item.label}</button>)}</nav>
    <div className="track-sidebar-spacer" />
    <button className={section === "calculator" ? "track-calculator-link active" : "track-calculator-link"} type="button" onClick={() => onNavigate("calculator")}><span>05</span>Calculator</button>
    <p className="track-sidebar-foot">Reverlo internal<br />DKK workspace</p>
  </aside>;
}

function SectionHeader({ kicker, title, detail, actions }: { kicker: string; title: string; detail: string; actions?: ReactNode }) {
  return <header className="track-topbar"><div><p className="track-kicker">{kicker}</p><h1>{title}</h1><p className="track-heading-detail">{detail}</p></div>{actions ? <div className="track-header-actions">{actions}</div> : <span className="track-date">Private · DKK ledger</span>}</header>;
}

function Metric({ index, label, value, detail, tone }: { index: string; label: string; value: string; detail: string; tone?: "positive" | "negative" }) {
  return <article className={`track-metric ${tone ? `track-metric-${tone}` : ""}`}><span>{index}</span><strong>{value}</strong><p>{label}</p><small>{detail}</small></article>;
}

function EmptyState({ code, title, detail, action }: { code: string; title: string; detail: string; action?: ReactNode }) {
  return <div className="track-empty-state"><span>{code}</span><strong>{title}</strong><p>{detail}</p>{action}</div>;
}

function LoadingScreen() {
  return <div className="track-loading" aria-label="Loading private tracker"><div className="track-loading-metrics">{[1, 2, 3, 4].map((item) => <i key={item} />)}</div><div className="track-loading-panels"><i /><i /></div></div>;
}

function Dialog({ title, kicker, children, onClose, wide = false }: { title: string; kicker: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", close); document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", close); document.body.style.overflow = ""; };
  }, [onClose]);
  return <div className="track-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={`track-dialog ${wide ? "track-dialog-wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby="track-dialog-title">
      <header><div><p className="track-kicker">{kicker}</p><h2 id="track-dialog-title">{title}</h2></div><button type="button" className="track-dialog-close" onClick={onClose} aria-label="Close dialog">×</button></header>{children}
    </section>
  </div>;
}

function InventoryForm({ product, onClose, onSaved }: { product?: TrackerProduct; onClose: () => void; onSaved: () => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null);
    const values = new FormData(event.currentTarget);
    const quantity = Number(values.get("quantity"));
    const purchasePriceOre = dkkToOre(values.get("purchasePrice"));
    const purchaseShippingOre = dkkToOre(values.get("purchaseShipping"));
    const expectedSalePriceOre = values.get("expectedSalePrice") ? dkkToOre(values.get("expectedSalePrice")) : null;
    const listingPriceOre = values.get("listingPrice") ? dkkToOre(values.get("listingPrice")) : null;
    if (!Number.isSafeInteger(quantity) || quantity < 1 || purchasePriceOre === null || purchaseShippingOre === null ||
        (values.get("expectedSalePrice") && expectedSalePriceOre === null) || (values.get("listingPrice") && listingPriceOre === null)) {
      setError("Use whole units and valid DKK amounts with no more than two decimals."); return;
    }
    setSaving(true);
    try {
      await responseJson(await fetch("/api/track/inventory", {
        method: product ? "PATCH" : "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: product?.id, name: values.get("name"), quantity, purchasePriceOre, purchaseShippingOre,
          expectedSalePriceOre, listingPriceOre, supplier: values.get("supplier"), purchaseDate: values.get("purchaseDate"),
          status: values.get("status"), notes: values.get("notes") }),
      }));
      await onSaved(); onClose();
    } catch (submitError) { setError(submitError instanceof Error ? submitError.message : "Unable to save the inventory item."); }
    finally { setSaving(false); }
  }
  const selectableStatuses = product?.remainingQuantity === 0 ? trackerStatuses : trackerStatuses.filter((status) => status !== "SOLD");
  return <form className="track-form" onSubmit={submit}>
    <div className="track-form-grid track-form-grid-main"><label className="track-field-wide">Product name<input name="name" defaultValue={product?.name} maxLength={160} placeholder="e.g. Starlink Mini" required /></label><label>Total quantity<input name="quantity" type="number" min="1" step="1" defaultValue={product?.quantity ?? 1} required /></label></div>
    {product ? <p className="track-form-note">{product.quantity - product.remainingQuantity} unit{product.quantity - product.remainingQuantity === 1 ? "" : "s"} already sold. Remaining quantity is recalculated from sales.</p> : <p className="track-form-note">Adding inventory also creates its purchase transaction automatically.</p>}
    <div className="track-form-grid"><label>Purchase price <small>per unit · DKK</small><input name="purchasePrice" inputMode="decimal" defaultValue={product ? (product.purchasePriceOre / 100).toFixed(2) : ""} placeholder="0,00" required /></label><label>Purchase shipping <small>total · DKK</small><input name="purchaseShipping" inputMode="decimal" defaultValue={product ? (product.purchaseShippingOre / 100).toFixed(2) : "0,00"} placeholder="0,00" required /></label><label>Expected sale price <small>per unit · DKK</small><input name="expectedSalePrice" inputMode="decimal" defaultValue={product?.expectedSalePriceOre !== null && product?.expectedSalePriceOre !== undefined ? (product.expectedSalePriceOre / 100).toFixed(2) : ""} placeholder="Optional" /></label><label>Listing price <small>per unit · DKK</small><input name="listingPrice" inputMode="decimal" defaultValue={product?.listingPriceOre !== null && product?.listingPriceOre !== undefined ? (product.listingPriceOre / 100).toFixed(2) : ""} placeholder="Optional" /></label><label>Supplier<input name="supplier" defaultValue={product?.supplier} maxLength={120} placeholder="Supplier or source" /></label><label>Purchase date<input name="purchaseDate" type="date" defaultValue={product?.purchaseDate ?? localDate()} required /></label><label>Status<select name="status" defaultValue={product?.status ?? "IN_STOCK"}>{selectableStatuses.map((status) => <option value={status} key={status}>{statusLabel(status)}</option>)}</select></label></div>
    <label>Notes<textarea name="notes" rows={4} maxLength={2000} defaultValue={product?.notes} placeholder="Condition, listing details, storage location…" /></label>
    {error ? <p className="track-form-error" role="alert">{error}</p> : null}
    <footer className="track-dialog-actions"><button type="button" className="track-button-secondary" onClick={onClose}>Cancel</button><button type="submit" className="track-button-primary" disabled={saving}>{saving ? "Saving…" : product ? "Save item" : "Add to inventory"}</button></footer>
  </form>;
}

function PurchaseForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => Promise<void> }) {
  const [error, setError] = useState<string | null>(null); const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null); const values = new FormData(event.currentTarget);
    const quantity = Number(values.get("quantity")); const unitPriceOre = dkkToOre(values.get("unitPrice")); const shippingOre = dkkToOre(values.get("shipping"));
    if (!Number.isSafeInteger(quantity) || quantity < 1 || unitPriceOre === null || shippingOre === null) { setError("Use whole units and valid DKK amounts."); return; }
    setSaving(true);
    try { await responseJson(await fetch("/api/track/transactions", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "PURCHASE", name: values.get("name"), quantity, unitPriceOre, shippingOre, supplier: values.get("supplier"), occurredAt: values.get("occurredAt") }) })); await onSaved(); onClose(); }
    catch (submitError) { setError(submitError instanceof Error ? submitError.message : "Unable to record the purchase."); } finally { setSaving(false); }
  }
  return <form className="track-form" onSubmit={submit}><div className="track-form-grid track-form-grid-main"><label className="track-field-wide">Product name<input name="name" maxLength={160} placeholder="Product or inventory batch" required /></label><label>Quantity<input name="quantity" type="number" min="1" step="1" defaultValue="1" required /></label></div><div className="track-form-grid"><label>Purchase price <small>per unit · DKK</small><input name="unitPrice" inputMode="decimal" placeholder="0,00" required /></label><label>Shipping <small>total · DKK</small><input name="shipping" inputMode="decimal" defaultValue="0,00" required /></label><label>Supplier<input name="supplier" maxLength={120} placeholder="Supplier or source" /></label><label>Purchase date<input name="occurredAt" type="date" defaultValue={localDate()} required /></label></div><p className="track-form-note">The purchase creates a new inventory batch. Expected and listing prices can be added from Inventory afterwards.</p>{error ? <p className="track-form-error" role="alert">{error}</p> : null}<footer className="track-dialog-actions"><button type="button" className="track-button-secondary" onClick={onClose}>Cancel</button><button type="submit" className="track-button-primary" disabled={saving}>{saving ? "Recording…" : "Record purchase"}</button></footer></form>;
}

function SaleForm({ products, onClose, onSaved }: { products: TrackerProduct[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const available = products.filter((product) => product.remainingQuantity > 0);
  const [selectedId, setSelectedId] = useState(available[0]?.id ?? ""); const [quantity, setQuantity] = useState("1");
  const [salePrice, setSalePrice] = useState(available[0] ? String((productTarget(available[0]) ?? 0) / 100) : "");
  const [fee, setFee] = useState("0"); const [promoted, setPromoted] = useState("0"); const [shipping, setShipping] = useState("0"); const [other, setOther] = useState("0");
  const [error, setError] = useState<string | null>(null); const [saving, setSaving] = useState(false);
  const product = available.find((item) => item.id === selectedId);
  const parsedQuantity = Number(quantity); const salePriceOre = dkkToOre(salePrice); const feeOre = dkkToOre(fee); const promotedFeeOre = dkkToOre(promoted); const shippingOre = dkkToOre(shipping); const otherCostsOre = dkkToOre(other);
  const preview = (() => {
    if (!product || !Number.isSafeInteger(parsedQuantity) || parsedQuantity < 1 || parsedQuantity > product.remainingQuantity || salePriceOre === null || feeOre === null || promotedFeeOre === null || shippingOre === null || otherCostsOre === null) return null;
    const soldBefore = product.quantity - product.remainingQuantity;
    const beforeShipping = Math.floor((product.purchaseShippingOre * soldBefore) / product.quantity);
    const afterShipping = Math.floor((product.purchaseShippingOre * (soldBefore + parsedQuantity)) / product.quantity);
    const costBasisOre = product.purchasePriceOre * parsedQuantity + afterShipping - beforeShipping;
    const revenueOre = salePriceOre * parsedQuantity; const totalCostsOre = costBasisOre + feeOre + promotedFeeOre + shippingOre + otherCostsOre;
    if (![costBasisOre, revenueOre, totalCostsOre].every((value) => Number.isSafeInteger(value) && value >= 0 && value <= 100_000_000_000)) return null;
    return { revenueOre, costBasisOre, totalCostsOre, profitOre: revenueOre - totalCostsOre };
  })();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null); const values = new FormData(event.currentTarget);
    if (!preview || !product) { setError("Check the quantity and DKK amounts before recording the sale."); return; }
    setSaving(true);
    try { await responseJson(await fetch("/api/track/transactions", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "SALE", productId: product.id, quantity: parsedQuantity, unitPriceOre: salePriceOre, platform: values.get("platform"), feeOre, promotedFeeOre, shippingOre, otherCostsOre, occurredAt: values.get("occurredAt") }) })); await onSaved(); onClose(); }
    catch (submitError) { setError(submitError instanceof Error ? submitError.message : "Unable to record the sale."); } finally { setSaving(false); }
  }
  if (!available.length) return <div className="track-dialog-empty"><EmptyState code="00" title="No sellable inventory" detail="Add a purchase or inventory item before recording a sale." /><footer className="track-dialog-actions"><button type="button" className="track-button-secondary" onClick={onClose}>Close</button></footer></div>;
  return <form className="track-form" onSubmit={submit}><div className="track-form-grid track-form-grid-main"><label className="track-field-wide">Inventory item<select value={selectedId} onChange={(event) => { const next = available.find((item) => item.id === event.target.value); setSelectedId(event.target.value); setSalePrice(next ? String((productTarget(next) ?? 0) / 100) : ""); }} required>{available.map((item) => <option value={item.id} key={item.id}>{item.name} · {item.remainingQuantity} available</option>)}</select></label><label>Quantity<input type="number" min="1" max={product?.remainingQuantity} step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} required /></label></div><div className="track-form-grid"><label>Sale price <small>per unit · DKK</small><input inputMode="decimal" value={salePrice} onChange={(event) => setSalePrice(event.target.value)} required /></label><label>Platform<input name="platform" maxLength={80} placeholder="eBay, Discord, Direct…" required /></label><label>Marketplace fees <small>total · DKK</small><input inputMode="decimal" value={fee} onChange={(event) => setFee(event.target.value)} required /></label><label>Promoted listing fee <small>total · DKK</small><input inputMode="decimal" value={promoted} onChange={(event) => setPromoted(event.target.value)} required /></label><label>Shipping <small>total · DKK</small><input inputMode="decimal" value={shipping} onChange={(event) => setShipping(event.target.value)} required /></label><label>Other costs <small>total · DKK</small><input inputMode="decimal" value={other} onChange={(event) => setOther(event.target.value)} required /></label><label>Sale date<input name="occurredAt" type="date" defaultValue={localDate()} required /></label></div>{preview ? <div className="track-sale-preview"><span><small>Revenue</small><strong>{formatMoney(preview.revenueOre)}</strong></span><span><small>Cost basis</small><strong>{formatMoney(preview.costBasisOre)}</strong></span><span><small>Total costs</small><strong>{formatMoney(preview.totalCostsOre)}</strong></span><span className={preview.profitOre >= 0 ? "positive" : "negative"}><small>Net profit</small><strong>{formatMoney(preview.profitOre)}</strong></span><span><small>Margin</small><strong>{formatPercent(preview.profitOre, preview.revenueOre)}</strong></span><span><small>ROI</small><strong>{formatPercent(preview.profitOre, preview.costBasisOre)}</strong></span></div> : null}{error ? <p className="track-form-error" role="alert">{error}</p> : null}<footer className="track-dialog-actions"><button type="button" className="track-button-secondary" onClick={onClose}>Cancel</button><button type="submit" className="track-button-primary" disabled={saving}>{saving ? "Recording…" : "Record sale"}</button></footer></form>;
}

function Overview({ data, onNavigate, onSale }: { data: OverviewData; onNavigate: (section: Section) => void; onSale: () => void }) {
  const series = cumulativeSeries(data.profitSeries);
  return <><SectionHeader kicker="Command centre" title="Overview" detail="A clean view of realised performance and capital still in stock." actions={<button className="track-button-primary" type="button" onClick={onSale}>＋ Record sale</button>} />
    <div className="track-metric-grid"><Metric index="01" label="Total profit" value={formatCompactMoney(data.metrics.totalProfitOre)} detail="Realised net profit" tone={data.metrics.totalProfitOre < 0 ? "negative" : "positive"} /><Metric index="02" label="Revenue" value={formatCompactMoney(data.metrics.revenueOre)} detail="Gross sales" /><Metric index="03" label="Inventory value" value={formatCompactMoney(data.metrics.inventoryValueOre)} detail="Remaining landed cost" /><Metric index="04" label="Cash invested" value={formatCompactMoney(data.metrics.cashInvestedOre)} detail="Lifetime purchase outlay" /></div>
    <div className="track-overview-grid"><section className="track-panel track-chart-panel"><div className="track-panel-heading"><div><p className="track-kicker">Performance</p><h2>Profit over time</h2></div><span>ALL</span></div>{series.length ? <><ProfitChart points={series} label="Cumulative net profit over time" /><div className="track-chart-axis"><span>{formatDate(series[0].date)}</span><strong>{formatMoney(series.at(-1)?.value ?? 0)}</strong><span>{formatDate(series.at(-1)?.date ?? series[0].date)}</span></div></> : <EmptyState code="00" title="No realised profit yet" detail="The chart starts with your first recorded sale." action={<button type="button" className="track-text-button" onClick={onSale}>Record a sale →</button>} />}</section>
      <section className="track-panel"><div className="track-panel-heading"><div><p className="track-kicker">Ledger</p><h2>Recent activity</h2></div><button type="button" className="track-text-button" onClick={() => onNavigate("transactions")}>View all →</button></div>{data.recentActivity.length ? <div className="track-activity-list">{data.recentActivity.map((entry) => <article key={entry.id}><span className={`track-activity-mark ${entry.type.toLowerCase()}`}>{entry.type === "SALE" ? "↗" : "↓"}</span><div><strong>{entry.productName}</strong><small>{entry.type === "SALE" ? `${entry.platform} · ${entry.quantity} sold` : `${entry.supplier || "Purchase"} · ${entry.quantity} bought`}</small></div><div><strong>{entry.type === "SALE" ? formatMoney(entry.revenueOre) : `−${formatMoney(entry.totalCostsOre)}`}</strong><small>{formatDate(entry.occurredAt)}</small></div></article>)}</div> : <EmptyState code="00" title="No activity yet" detail="Purchases and sales will form your private ledger." />}</section></div>
    <section className="track-panel track-snapshot"><div className="track-panel-heading"><div><p className="track-kicker">Stock position</p><h2>Inventory snapshot</h2></div><button type="button" className="track-text-button" onClick={() => onNavigate("inventory")}>Open inventory →</button></div>{data.inventorySnapshot.length ? <div className="track-snapshot-grid">{data.inventorySnapshot.map((product) => { const target = productTarget(product); const potential = potentialProfit(product); return <article key={product.id}><div><span className={statusClass(product.status)}>{statusLabel(product.status)}</span><strong>{product.name}</strong><small>{product.remainingQuantity} of {product.quantity} remaining</small></div><div><small>Target</small><strong>{target === null ? "—" : formatMoney(target)}</strong></div><div><small>Potential</small><strong className={potential !== null && potential < 0 ? "negative" : "positive"}>{potential === null ? "—" : formatMoney(potential)}</strong></div></article>; })}</div> : <EmptyState code="00" title="Inventory is empty" detail="Add your first product or record a purchase to begin." action={<button className="track-text-button" type="button" onClick={() => onNavigate("inventory")}>Add inventory →</button>} />}</section>
  </>;
}

function Inventory({ products, onAdd, onEdit, onDelete }: { products: TrackerProduct[]; onAdd: () => void; onEdit: (product: TrackerProduct) => void; onDelete: (product: TrackerProduct) => void }) {
  const [query, setQuery] = useState(""); const [filter, setFilter] = useState<"ALL" | TrackerStatus>("ALL");
  const visible = useMemo(() => products.filter((product) => (filter === "ALL" || product.status === filter) && (!query || `${product.name} ${product.supplier}`.toLowerCase().includes(query.toLowerCase()))), [products, query, filter]);
  return <><SectionHeader kicker="Stock ledger" title="Inventory" detail="Every batch, unit and expected return in one controlled view." actions={<button className="track-button-primary" type="button" onClick={onAdd}>＋ Add item</button>} />
    <div className="track-toolbar"><label className="track-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search product or supplier" aria-label="Search inventory" /></label><div className="track-filter-group">{(["ALL", ...trackerStatuses] as const).map((status) => <button type="button" className={filter === status ? "active" : ""} onClick={() => setFilter(status)} key={status}>{status === "ALL" ? "All" : statusLabel(status)}<span>{status === "ALL" ? products.length : products.filter((product) => product.status === status).length}</span></button>)}</div></div>
    <section className="track-table-panel">{visible.length ? <div className="track-table-scroll"><table className="track-data-table"><thead><tr><th>Product</th><th>Stock</th><th>Purchase</th><th>Target</th><th>Status</th><th>Potential</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{visible.map((product) => { const target = productTarget(product); const potential = potentialProfit(product); const cost = remainingCost(product); return <tr key={product.id}><td><strong>{product.name}</strong><small>{product.supplier || "No supplier"} · {formatDate(product.purchaseDate)}</small></td><td><strong>{product.remainingQuantity} / {product.quantity}</strong><small>remaining</small></td><td><strong>{formatMoney(product.purchasePriceOre)}</strong><small>{formatMoney(cost)} open cost</small></td><td><strong>{target === null ? "—" : formatMoney(target)}</strong><small>{product.listingPriceOre !== null ? "listing" : product.expectedSalePriceOre !== null ? "expected" : "not set"}</small></td><td><span className={statusClass(product.status)}>{statusLabel(product.status)}</span></td><td><strong className={potential !== null && potential < 0 ? "negative" : "positive"}>{potential === null ? "—" : formatMoney(potential)}</strong><small>{potential === null ? "Set a target" : `${formatPercent(potential, cost)} ROI`}</small></td><td><div className="track-row-actions"><button type="button" onClick={() => onEdit(product)}>Edit</button><button type="button" className="danger" onClick={() => onDelete(product)}>Delete</button></div></td></tr>; })}</tbody></table></div> : <EmptyState code="00" title={products.length ? "No matching inventory" : "Your inventory is ready"} detail={products.length ? "Adjust the search or status filter." : "Add the first product batch to start tracking stock and potential profit."} action={!products.length ? <button className="track-button-primary" type="button" onClick={onAdd}>＋ Add first item</button> : undefined} />}</section>
  </>;
}

function Transactions({ transactions, onPurchase, onSale }: { transactions: TrackerTransaction[]; onPurchase: () => void; onSale: () => void }) {
  const [filter, setFilter] = useState<TransactionFilter>("ALL");
  const visible = transactions.filter((transaction) => filter === "ALL" || transaction.type === filter);
  const counts = { ALL: transactions.length, PURCHASE: transactions.filter((item) => item.type === "PURCHASE").length, SALE: transactions.filter((item) => item.type === "SALE").length };
  return <><SectionHeader kicker="Unified ledger" title="Transactions" detail="Purchases fund inventory. Sales release profit and reduce stock automatically." actions={<><button className="track-button-secondary" type="button" onClick={onPurchase}>↓ Purchase</button><button className="track-button-primary" type="button" onClick={onSale}>↗ Sale</button></>} />
    <div className="track-transaction-tabs" role="tablist" aria-label="Filter transactions">{(["ALL", "PURCHASE", "SALE"] as const).map((item) => <button role="tab" aria-selected={filter === item} className={filter === item ? "active" : ""} type="button" onClick={() => setFilter(item)} key={item}>{item === "ALL" ? "All" : item === "PURCHASE" ? "Purchases" : "Sales"}<span>{counts[item]}</span></button>)}</div>
    <section className="track-table-panel">{visible.length ? <div className="track-transaction-list">{visible.map((transaction) => <article key={transaction.id}><div className={`track-transaction-type ${transaction.type.toLowerCase()}`}><span>{transaction.type === "SALE" ? "↗" : "↓"}</span><small>{transaction.type}</small></div><div className="track-transaction-product"><strong>{transaction.productName}</strong><small>{transaction.type === "SALE" ? transaction.platform : transaction.supplier || "Purchase"} · {formatDate(transaction.occurredAt)}</small></div><div><small>Units</small><strong>{transaction.quantity}</strong></div><div><small>{transaction.type === "SALE" ? "Revenue" : "Purchase"}</small><strong>{transaction.type === "SALE" ? formatMoney(transaction.revenueOre) : formatMoney(transaction.totalCostsOre)}</strong></div><div><small>Cost basis</small><strong>{formatMoney(transaction.costBasisOre)}</strong></div><div><small>Total costs</small><strong>{formatMoney(transaction.totalCostsOre)}</strong></div><div className="track-transaction-result"><small>{transaction.type === "SALE" ? "Net profit" : "Cash out"}</small><strong className={transaction.type === "SALE" ? transaction.netProfitOre >= 0 ? "positive" : "negative" : ""}>{transaction.type === "SALE" ? formatMoney(transaction.netProfitOre) : `−${formatMoney(transaction.totalCostsOre)}`}</strong>{transaction.type === "SALE" ? <span>{formatPercent(transaction.netProfitOre, transaction.revenueOre)} margin · {formatPercent(transaction.netProfitOre, transaction.costBasisOre)} ROI</span> : null}</div></article>)}</div> : <EmptyState code="00" title="No transactions in this view" detail="Record a purchase to add stock, or a sale to realise profit." action={<div className="track-empty-actions"><button className="track-button-secondary" type="button" onClick={onPurchase}>Record purchase</button><button className="track-button-primary" type="button" onClick={onSale}>Record sale</button></div>} />}</section>
  </>;
}

function Analytics({ data, period, onPeriod }: { data: AnalyticsData; period: AnalyticsPeriod; onPeriod: (period: AnalyticsPeriod) => void }) {
  const cumulative = cumulativeSeries(data.series); const maxComparison = Math.max(1, data.totals.revenueOre, data.totals.costsOre);
  return <><SectionHeader kicker="Performance layer" title="Analytics" detail="Only the numbers that help you judge products and capital efficiency." actions={<div className="track-periods">{(["30D", "90D", "YTD", "ALL"] as const).map((item) => <button className={period === item ? "active" : ""} type="button" key={item} onClick={() => onPeriod(item)}>{item}</button>)}</div>} />
    <div className="track-analytics-metrics"><Metric index="01" label="Units sold" value={String(data.totals.unitsSold)} detail={`${period} period`} /><Metric index="02" label="Revenue" value={formatCompactMoney(data.totals.revenueOre)} detail="Gross sales" /><Metric index="03" label="Net profit" value={formatCompactMoney(data.totals.profitOre)} detail={`${formatPercent(data.totals.profitOre, data.totals.revenueOre)} margin`} tone={data.totals.profitOre < 0 ? "negative" : "positive"} /><Metric index="04" label="ROI" value={formatPercent(data.totals.profitOre, data.totals.costBasisOre)} detail="Profit / cost basis" /></div>
    <div className="track-analytics-grid"><section className="track-panel track-chart-panel"><div className="track-panel-heading"><div><p className="track-kicker">Net performance</p><h2>Profit over time</h2></div><span>{period}</span></div>{cumulative.length ? <><ProfitChart points={cumulative} label={`Cumulative profit for ${period}`} /><div className="track-chart-axis"><span>{formatDate(cumulative[0].date)}</span><strong>{formatMoney(cumulative.at(-1)?.value ?? 0)}</strong><span>{formatDate(cumulative.at(-1)?.date ?? cumulative[0].date)}</span></div></> : <EmptyState code="00" title="No sales in this period" detail="Choose another period or record a sale." />}</section><section className="track-panel track-comparison"><div className="track-panel-heading"><div><p className="track-kicker">Capital movement</p><h2>Revenue vs. costs</h2></div></div><div className="track-comparison-bars"><article><div><span>Revenue</span><strong>{formatMoney(data.totals.revenueOre)}</strong></div><i><b style={{ width: `${(data.totals.revenueOre / maxComparison) * 100}%` }} /></i></article><article className="cost"><div><span>Total costs</span><strong>{formatMoney(data.totals.costsOre)}</strong></div><i><b style={{ width: `${(data.totals.costsOre / maxComparison) * 100}%` }} /></i></article></div><dl><div><dt>Cost basis</dt><dd>{formatMoney(data.totals.costBasisOre)}</dd></div><div><dt>Selling costs</dt><dd>{formatMoney(Math.max(0, data.totals.costsOre - data.totals.costBasisOre))}</dd></div><div><dt>Net result</dt><dd className={data.totals.profitOre >= 0 ? "positive" : "negative"}>{formatMoney(data.totals.profitOre)}</dd></div></dl></section></div>
    <section className="track-table-panel track-performance"><div className="track-panel-heading"><div><p className="track-kicker">Product performance</p><h2>What is actually working</h2></div><span>{data.products.length} products</span></div>{data.products.length ? <div className="track-table-scroll"><table className="track-data-table"><thead><tr><th>Product</th><th>Units sold</th><th>Revenue</th><th>Profit</th><th>Margin</th><th>ROI</th></tr></thead><tbody>{data.products.map((product, index) => <tr key={product.productName}><td><strong>{product.productName}</strong><small>Rank {String(index + 1).padStart(2, "0")}</small></td><td><strong>{product.unitsSold}</strong></td><td><strong>{formatMoney(product.revenueOre)}</strong></td><td><strong className={product.profitOre >= 0 ? "positive" : "negative"}>{formatMoney(product.profitOre)}</strong></td><td><strong>{formatPercent(product.profitOre, product.revenueOre)}</strong></td><td><strong>{formatPercent(product.profitOre, product.costBasisOre)}</strong></td></tr>)}</tbody></table></div> : <EmptyState code="00" title="No product performance yet" detail="Sales will build a simple product ranking here." />}</section>
  </>;
}

function Calculator() {
  const [purchase, setPurchase] = useState("1000"); const [sale, setSale] = useState("1500"); const [marketFee, setMarketFee] = useState("12.8"); const [promotedFee, setPromotedFee] = useState("2"); const [shipping, setShipping] = useState("70"); const [other, setOther] = useState("0"); const [targetRoi, setTargetRoi] = useState("25");
  const result = useMemo(() => {
    const purchaseOre = dkkToOre(purchase); const saleOre = dkkToOre(sale); const shippingOre = dkkToOre(shipping); const otherOre = dkkToOre(other); const marketBps = percentToBps(marketFee); const promotedBps = percentToBps(promotedFee); const targetBps = percentToBps(targetRoi);
    if ([purchaseOre, saleOre, shippingOre, otherOre, marketBps, promotedBps, targetBps].some((value) => value === null) || marketBps! + promotedBps! >= 10_000) return null;
    const feeOre = Math.round((saleOre! * (marketBps! + promotedBps!)) / 10_000); const profitOre = saleOre! - purchaseOre! - feeOre - shippingOre! - otherOre!;
    const breakEvenOre = Math.ceil(((purchaseOre! + shippingOre! + otherOre!) * 10_000) / (10_000 - marketBps! - promotedBps!));
    const afterFeesAndCosts = Math.floor((saleOre! * (10_000 - marketBps! - promotedBps!)) / 10_000) - shippingOre! - otherOre!;
    const maxPurchaseOre = Math.max(0, Math.floor((afterFeesAndCosts * 10_000) / (10_000 + targetBps!)));
    return { profitOre, margin: formatPercent(profitOre, saleOre!), roi: formatPercent(profitOre, purchaseOre!), breakEvenOre, maxPurchaseOre, feeOre };
  }, [purchase, sale, marketFee, promotedFee, shipping, other, targetRoi]);
  return <><SectionHeader kicker="Decision tool" title="Profit Calculator" detail="Test a deal before it enters inventory. Nothing here is saved." />
    <section className="track-calculator"><form className="track-calculator-inputs" onSubmit={(event) => event.preventDefault()}><div className="track-panel-heading"><div><p className="track-kicker">Deal assumptions</p><h2>Input</h2></div><span>DKK</span></div><div className="track-form-grid"><label>Purchase price <small>DKK</small><input inputMode="decimal" value={purchase} onChange={(event) => setPurchase(event.target.value)} /></label><label>Expected sale price <small>DKK</small><input inputMode="decimal" value={sale} onChange={(event) => setSale(event.target.value)} /></label><label>Marketplace fee <small>%</small><input inputMode="decimal" value={marketFee} onChange={(event) => setMarketFee(event.target.value)} /></label><label>Promoted fee <small>%</small><input inputMode="decimal" value={promotedFee} onChange={(event) => setPromotedFee(event.target.value)} /></label><label>Shipping <small>DKK</small><input inputMode="decimal" value={shipping} onChange={(event) => setShipping(event.target.value)} /></label><label>Other costs <small>DKK</small><input inputMode="decimal" value={other} onChange={(event) => setOther(event.target.value)} /></label><label>Target ROI <small>% · for max buy price</small><input inputMode="decimal" value={targetRoi} onChange={(event) => setTargetRoi(event.target.value)} /></label></div><p className="track-form-note">Percentages are calculated against the expected sale price. ROI uses purchase price as invested capital.</p></form><aside className="track-calculator-results"><p className="track-kicker">Expected outcome</p>{result ? <><div className={`track-calculator-profit ${result.profitOre >= 0 ? "positive" : "negative"}`}><span>Expected profit</span><strong>{formatMoney(result.profitOre)}</strong><small>after {formatMoney(result.feeOre)} in percentage fees</small></div><dl><div><dt>Margin</dt><dd>{result.margin}</dd></div><div><dt>ROI</dt><dd>{result.roi}</dd></div><div><dt>Break-even price</dt><dd>{formatMoney(result.breakEvenOre)}</dd></div><div className="highlight"><dt>Maximum purchase price</dt><dd>{formatMoney(result.maxPurchaseOre)}</dd><small>for a {targetRoi || "0"}% target ROI</small></div></dl></> : <EmptyState code="—" title="Check the inputs" detail="Use positive DKK amounts and keep combined fees below 100%." />}</aside></section>
  </>;
}

export default function TrackerApp() {
  const [section, setSection] = useState<Section>("overview"); const [overview, setOverview] = useState(emptyOverview); const [inventory, setInventory] = useState<TrackerProduct[]>([]); const [transactions, setTransactions] = useState<TrackerTransaction[]>([]); const [analytics, setAnalytics] = useState(emptyAnalytics); const [period, setPeriod] = useState<AnalyticsPeriod>("30D");
  const [loading, setLoading] = useState(true); const [refreshing, setRefreshing] = useState(false); const [error, setError] = useState<string | null>(null); const [dialog, setDialog] = useState<DialogState>(null);
  const navigate = useCallback((next: Section) => { setSection(next); window.scrollTo({ top: 0, behavior: "smooth" }); }, []);
  const loadCore = useCallback(async (initial = false) => {
    if (initial) setLoading(true); else setRefreshing(true); setError(null);
    try { const [overviewResult, inventoryResult, transactionResult] = await Promise.all([
      fetch("/api/track/overview", { cache: "no-store", credentials: "same-origin" }).then((response) => responseJson<OverviewData>(response)),
      fetch("/api/track/inventory", { cache: "no-store", credentials: "same-origin" }).then((response) => responseJson<{ products: TrackerProduct[] }>(response)),
      fetch("/api/track/transactions", { cache: "no-store", credentials: "same-origin" }).then((response) => responseJson<{ transactions: TrackerTransaction[] }>(response)),
    ]); setOverview(overviewResult); setInventory(inventoryResult.products); setTransactions(transactionResult.transactions); }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Unable to load the private tracker."); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);
  const loadAnalytics = useCallback(async (selectedPeriod: AnalyticsPeriod) => {
    try { setAnalytics(await responseJson<AnalyticsData>(await fetch(`/api/track/analytics?period=${selectedPeriod}`, { cache: "no-store", credentials: "same-origin" }))); }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Unable to load analytics."); }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => void loadCore(true), 0); return () => window.clearTimeout(timer); }, [loadCore]);
  useEffect(() => { const timer = window.setTimeout(() => void loadAnalytics(period), 0); return () => window.clearTimeout(timer); }, [loadAnalytics, period]);
  const refresh = useCallback(async () => { await Promise.all([loadCore(false), loadAnalytics(period)]); }, [loadCore, loadAnalytics, period]);
  async function deleteProduct(product: TrackerProduct) {
    setError(null);
    try { await responseJson(await fetch("/api/track/inventory", { method: "DELETE", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: product.id }) })); setDialog(null); await refresh(); }
    catch (deleteError) { setError(deleteError instanceof Error ? deleteError.message : "Unable to delete the inventory item."); setDialog(null); }
  }
  return <main className="track-root"><Sidebar section={section} onNavigate={navigate} /><section className="track-main">{error ? <div className="track-global-error" role="alert"><span>!</span><p>{error}</p><button type="button" onClick={() => void refresh()}>Retry</button></div> : null}{refreshing ? <span className="track-refreshing">Refreshing ledger…</span> : null}{loading ? <><SectionHeader kicker="Private workspace" title="Loading tracker" detail="Preparing the DKK ledger and inventory position." /><LoadingScreen /></> : section === "overview" ? <Overview data={overview} onNavigate={navigate} onSale={() => setDialog({ kind: "sale" })} /> : section === "inventory" ? <Inventory products={inventory} onAdd={() => setDialog({ kind: "inventory" })} onEdit={(product) => setDialog({ kind: "inventory", product })} onDelete={(product) => setDialog({ kind: "delete", product })} /> : section === "transactions" ? <Transactions transactions={transactions} onPurchase={() => setDialog({ kind: "purchase" })} onSale={() => setDialog({ kind: "sale" })} /> : section === "analytics" ? <Analytics data={analytics} period={period} onPeriod={setPeriod} /> : <Calculator />}</section>
    {dialog?.kind === "inventory" ? <Dialog title={dialog.product ? "Edit inventory item" : "Add inventory item"} kicker={dialog.product ? "Inventory control" : "New stock"} onClose={() => setDialog(null)} wide><InventoryForm product={dialog.product} onClose={() => setDialog(null)} onSaved={refresh} /></Dialog> : null}
    {dialog?.kind === "purchase" ? <Dialog title="Record purchase" kicker="Cash into inventory" onClose={() => setDialog(null)} wide><PurchaseForm onClose={() => setDialog(null)} onSaved={refresh} /></Dialog> : null}
    {dialog?.kind === "sale" ? <Dialog title="Record sale" kicker="Realise performance" onClose={() => setDialog(null)} wide><SaleForm products={inventory} onClose={() => setDialog(null)} onSaved={refresh} /></Dialog> : null}
    {dialog?.kind === "delete" ? <Dialog title="Delete inventory item?" kicker="Permanent ledger change" onClose={() => setDialog(null)}><div className="track-delete-copy"><p>This permanently removes <strong>{dialog.product.name}</strong> and every purchase or sale connected to this inventory batch. It cannot be undone.</p></div><footer className="track-dialog-actions"><button type="button" className="track-button-secondary" onClick={() => setDialog(null)}>Keep item</button><button type="button" className="track-button-danger" onClick={() => void deleteProduct(dialog.product)}>Delete item & transactions</button></footer></Dialog> : null}
  </main>;
}
