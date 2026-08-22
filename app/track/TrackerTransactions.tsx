"use client";

import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { calculateVatAmounts, recalculateProductSales } from "../../lib/tracker-accounting";
import { useTrackerI18n } from "./i18n";
import { vatTreatments, type PriceMode, type TrackerProduct, type TrackerTransaction, type TransactionType, type VatTreatment } from "./types";

type Filter = "ALL" | TransactionType;

const treatmentLabels: Record<VatTreatment | "", string> = {
  "": "Choose VAT treatment",
  DANISH_PURCHASE_DEDUCTIBLE: "Danish purchase · deductible VAT",
  DANISH_SALE_VAT: "Danish sale · VAT",
  EU_B2B_SALE_REVERSE_CHARGE: "EU B2B sale · 0% / reverse charge",
  EU_PURCHASE_REVERSE_CHARGE: "EU purchase · reverse charge",
  PRIVATE_PURCHASE_NO_DEDUCTION: "Private purchase · no deduction",
  NO_VAT_OUTSIDE_SCOPE: "No VAT / outside scope",
  CUSTOM_MANUAL: "Custom / manual",
};

function localDate() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dkkToOre(value: string | FormDataEntryValue | null) {
  const match = String(value ?? "").trim().replace(/\s/g, "").replace(",", ".").match(/^(\d{1,10})(?:\.(\d{0,2}))?$/);
  if (!match) return null;
  const amount = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(amount) && amount >= 0 && amount <= 100_000_000_000 ? amount : null;
}

function percentToBps(value: string) {
  const match = value.trim().replace(",", ".").match(/^(\d{1,3})(?:\.(\d{0,2}))?$/);
  if (!match) return null;
  const bps = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return bps <= 10_000 ? bps : null;
}

function rateInput(value: number | null | undefined) { return value === null || value === undefined ? "0" : (value / 100).toFixed(2).replace(/\.00$/, ""); }
async function responseJson<T>(response: Response) {
  const payload = await response.json() as T & { error?: string; errorCode?: string };
  if (!response.ok) throw new Error(payload.errorCode ?? payload.error ?? "TRACKER_REQUEST_FAILED");
  return payload;
}

function Modal({ title, kicker, children, onClose, wide = false }: { title: string; kicker: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const { t } = useTrackerI18n();
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", close); document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", close); document.body.style.overflow = ""; };
  }, [onClose]);
  return <div className="track-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className={`track-dialog ${wide ? "track-dialog-wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby="transaction-dialog-title"><header><div><p className="track-kicker">{kicker}</p><h2 id="transaction-dialog-title">{title}</h2></div><button type="button" className="track-dialog-close" onClick={onClose} aria-label={t("Close dialog")}>×</button></header>{children}</section></div>;
}

function allowedTreatments(type: TransactionType) {
  return ["" as const, ...vatTreatments.filter((treatment) => type === "PURCHASE"
    ? treatment !== "DANISH_SALE_VAT" && treatment !== "EU_B2B_SALE_REVERSE_CHARGE"
    : treatment !== "DANISH_PURCHASE_DEDUCTIBLE" && treatment !== "EU_PURCHASE_REVERSE_CHARGE" && treatment !== "PRIVATE_PURCHASE_NO_DEDUCTION")];
}

function VatFields({ type, treatment, setTreatment: updateTreatment, priceMode, setPriceMode, rate, setRate, transaction }: {
  type: TransactionType; treatment: VatTreatment | ""; setTreatment: (value: VatTreatment | "") => void;
  priceMode: PriceMode; setPriceMode: (value: PriceMode) => void; rate: string; setRate: (value: string) => void;
  transaction?: TrackerTransaction;
}) {
  const { t } = useTrackerI18n();
  const [open, setOpen] = useState(!transaction?.vatTreatment);
  function setTreatment(value: VatTreatment | "") {
    updateTreatment(value);
    if (value === "DANISH_PURCHASE_DEDUCTIBLE" || value === "DANISH_SALE_VAT" || value === "EU_PURCHASE_REVERSE_CHARGE") setRate("25");
    if (value === "EU_B2B_SALE_REVERSE_CHARGE" || value === "NO_VAT_OUTSIDE_SCOPE") setRate("0");
  }
  return <fieldset className="track-vat-fields"><button type="button" className="track-vat-toggle" onClick={() => setOpen((value) => !value)} aria-expanded={open}><span>{open ? "−" : "+"}</span>{t(open ? "Hide VAT details" : "Advanced VAT details")}</button>{open ? <div className="track-vat-fields-body"><div className="track-form-grid"><label>{t("VAT treatment")}<select name="vatTreatment" value={treatment} onChange={(event) => setTreatment(event.target.value as VatTreatment)}>{allowedTreatments(type).map((value) => <option value={value} key={value}>{t(treatmentLabels[value])}</option>)}</select></label><label>{t("Price basis")}<select name="priceMode" value={priceMode} onChange={(event) => setPriceMode(event.target.value as PriceMode)}><option value="VAT_EXCLUSIVE">{t("VAT exclusive")}</option><option value="VAT_INCLUSIVE">{t("VAT inclusive")}</option></select></label><label>{t("VAT rate")} <small>%</small><input name="vatRate" inputMode="decimal" value={rate} onChange={(event) => setRate(event.target.value)} /></label>{type === "PURCHASE" ? <label>{t("Supplier country")} <small>ISO 3166-1</small><input name="supplierCountry" defaultValue={transaction?.supplierCountry ?? ""} maxLength={2} placeholder="DK" /></label> : <><label>{t("Customer country")} <small>ISO 3166-1</small><input name="customerCountry" defaultValue={transaction?.customerCountry ?? ""} maxLength={2} placeholder="DE" /></label><label>{t("VAT ID reference")}<input name="vatIdReference" defaultValue={transaction?.vatIdReference ?? ""} maxLength={80} placeholder="DE123456789" /></label><label className="track-checkbox-field">{t("Customer type")}<span className="track-checkbox-control"><input name="isB2b" type="checkbox" defaultChecked={Boolean(transaction?.isB2b)} /><span>{t("Business customer (B2B)")}</span></span></label></>}</div>{treatment === "CUSTOM_MANUAL" ? <div className="track-form-grid track-vat-manual">{type === "PURCHASE" ? <><label>{t("Input VAT")} <small>DKK</small><input name="inputVat" inputMode="decimal" defaultValue={oreInput(transaction?.inputVatOre)} required /></label><label>{t("Deductible VAT")} <small>DKK</small><input name="deductibleVat" inputMode="decimal" defaultValue={oreInput(transaction?.deductibleVatOre)} required /></label></> : null}<label>{t("Output VAT")} <small>DKK</small><input name="outputVat" inputMode="decimal" defaultValue={oreInput(transaction?.outputVatOre)} required /></label></div> : null}</div> : null}</fieldset>;
}

export function TrackerTransactionDialog({ type, transaction, transactions, products, onClose, onSaved }: {
  type: TransactionType; transaction?: TrackerTransaction; transactions: TrackerTransaction[]; products: TrackerProduct[]; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const { t, money, percent, decimal } = useTrackerI18n();
  const available = products.filter((product) => product.remainingQuantity > 0 || product.id === transaction?.productId);
  const initialProductId = transaction?.productId ?? available[0]?.id ?? "";
  const [selectedId, setSelectedId] = useState(initialProductId);
  const [quantity, setQuantity] = useState(String(transaction?.quantity ?? 1));
  const selected = products.find((product) => product.id === selectedId);
  const initialPrice = type === "SALE"
    ? transaction?.enteredTotalPriceOre ?? transaction?.grossAmountOre ?? transaction?.revenueOre ?? (selected ? (selected.listingPriceOre ?? selected.expectedSalePriceOre ?? 0) : 0)
    : transaction?.enteredUnitPriceOre ?? transaction?.unitPriceOre ?? 0;
  const [price, setPrice] = useState(decimal(initialPrice));
  const [shipping, setShipping] = useState(decimal(transaction?.enteredShippingOre ?? transaction?.shippingOre ?? 0));
  const [fee, setFee] = useState(decimal(transaction?.feeOre ?? 0));
  const [promoted, setPromoted] = useState(decimal(transaction?.promotedFeeOre ?? 0));
  const [other, setOther] = useState(decimal(transaction?.otherCostsOre ?? 0));
  const [priceMode, setPriceMode] = useState<PriceMode>(transaction?.priceMode ?? "VAT_EXCLUSIVE");
  const [treatment, setTreatment] = useState<VatTreatment | "">(transaction?.vatTreatment ?? "");
  const [rate, setRate] = useState(rateInput(transaction?.vatRateBps));
  const [occurredAt, setOccurredAt] = useState(transaction?.occurredAt ?? localDate());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const preview = useMemo(() => {
    const parsedQuantity = Number(quantity); const enteredPriceOre = dkkToOre(price); const enteredShippingOre = dkkToOre(shipping);
    const feeOre = dkkToOre(fee); const promotedFeeOre = dkkToOre(promoted); const otherCostsOre = dkkToOre(other); const vatRateBps = percentToBps(rate);
    if (!treatment || !selected && type === "SALE" || !Number.isSafeInteger(parsedQuantity) || parsedQuantity < 1 || enteredPriceOre === null || enteredShippingOre === null || feeOre === null || promotedFeeOre === null || otherCostsOre === null || vatRateBps === null || treatment === "CUSTOM_MANUAL") return null;
    const capacity = selected ? selected.remainingQuantity + (transaction?.productId === selected.id ? transaction.quantity : 0) : parsedQuantity;
    if (type === "SALE" && parsedQuantity > capacity) return null;
    try {
      const enteredUnitPriceOre = type === "SALE" ? Math.round(enteredPriceOre / parsedQuantity) : enteredPriceOre;
      const amounts = calculateVatAmounts({ type, quantity: parsedQuantity, enteredUnitPriceOre, enteredShippingOre,
        enteredTotalPriceOre: type === "SALE" ? enteredPriceOre : null, priceMode, vatTreatment: treatment, vatRateBps });
      if (type === "PURCHASE") return { ...amounts, costBasisOre: amounts.economicPurchaseCostOre, totalCostsOre: amounts.economicPurchaseCostOre, profitOre: 0 };
      const candidateId = transaction?.id ?? "__preview__";
      const otherSales = transactions.filter((item) => item.type === "SALE" && item.productId === selected!.id && item.id !== transaction?.id)
        .map((item) => ({ id: item.id, quantity: item.quantity, revenueOre: item.revenueOre, feeOre: item.feeOre,
          promotedFeeOre: item.promotedFeeOre, shippingOre: item.shippingOre, otherCostsOre: item.otherCostsOre,
          occurredAt: item.occurredAt, createdAt: item.createdAt }));
      const ledger = recalculateProductSales(selected!, [...otherSales, { id: candidateId, quantity: parsedQuantity,
        revenueOre: amounts.revenueOre, feeOre, promotedFeeOre, shippingOre: enteredShippingOre, otherCostsOre,
        occurredAt, createdAt: transaction?.createdAt ?? "9999" }]);
      const previewSale = ledger.sales.find((item) => item.id === candidateId)!;
      return { ...amounts, costBasisOre: previewSale.costBasisOre, totalCostsOre: previewSale.totalCostsOre, profitOre: previewSale.netProfitOre };
    } catch { return null; }
  }, [fee, occurredAt, other, price, priceMode, promoted, quantity, rate, selected, shipping, transaction, transactions, treatment, type]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null);
    const values = new FormData(event.currentTarget);
    const parsedQuantity = Number(quantity); const enteredPriceOre = dkkToOre(price); const shippingOre = dkkToOre(shipping);
    const feeOre = dkkToOre(fee); const promotedFeeOre = dkkToOre(promoted); const otherCostsOre = dkkToOre(other); const vatRateBps = percentToBps(rate);
    const inputVatOre = treatment === "CUSTOM_MANUAL" ? dkkToOre(values.get("inputVat")) : null;
    const outputVatOre = treatment === "CUSTOM_MANUAL" ? dkkToOre(values.get("outputVat")) : null;
    const deductibleVatOre = treatment === "CUSTOM_MANUAL" ? dkkToOre(values.get("deductibleVat")) : null;
    if (!treatment || !Number.isSafeInteger(parsedQuantity) || parsedQuantity < 1 || enteredPriceOre === null || shippingOre === null || feeOre === null || promotedFeeOre === null || otherCostsOre === null || vatRateBps === null ||
      (treatment === "CUSTOM_MANUAL" && (outputVatOre === null || type === "PURCHASE" && (inputVatOre === null || deductibleVatOre === null)))) {
      setError(t("Check the quantity and DKK amounts before saving.")); return;
    }
    setSaving(true);
    try {
      const unitPriceOre = type === "SALE" ? Math.round(enteredPriceOre / parsedQuantity) : enteredPriceOre;
      await responseJson(await fetch("/api/track/transactions", {
        method: transaction ? "PATCH" : "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: transaction?.id, type, productId: selectedId, name: values.get("name"), quantity: parsedQuantity,
          unitPriceOre, totalPriceOre: type === "SALE" ? enteredPriceOre : null,
          shippingOre, supplier: values.get("supplier"), platform: values.get("platform"),
          feeOre, promotedFeeOre, otherCostsOre, occurredAt, notes: values.get("notes"),
          priceMode, vatTreatment: treatment, vatRateBps, inputVatOre, outputVatOre, deductibleVatOre,
          supplierCountry: values.get("supplierCountry"), customerCountry: values.get("customerCountry"),
          isB2b: values.get("isB2b") === "on", vatIdReference: values.get("vatIdReference"),
        }),
      }));
      await onSaved(); onClose();
    } catch (submitError) { setError(t(submitError instanceof Error ? submitError.message : "TRACKER_REQUEST_FAILED")); }
    finally { setSaving(false); }
  }

  const title = transaction ? t("Update transaction") : t(type === "PURCHASE" ? "Record purchase" : "Record sale");
  if (type === "SALE" && !available.length) return <Modal title={title} kicker={t("Unified ledger")} onClose={onClose}><div className="track-dialog-empty"><div className="track-empty-state"><span>00</span><strong>{t("No sellable inventory")}</strong><p>{t("Add a purchase or inventory item before recording a sale.")}</p></div><footer className="track-dialog-actions"><button className="track-button-secondary" type="button" onClick={onClose}>{t("Close")}</button></footer></div></Modal>;
  return <Modal title={title} kicker={t(type === "PURCHASE" ? "Purchase" : "Sale")} onClose={onClose} wide><form className="track-form" onSubmit={submit}><div className="track-form-grid track-form-grid-main">{type === "PURCHASE" ? <label className="track-field-wide">{t("Product name")}<input name="name" defaultValue={transaction?.productName} maxLength={160} placeholder="Starlink Mini" required /></label> : <label className="track-field-wide">{t("Inventory item")}<select value={selectedId} onChange={(event) => { setSelectedId(event.target.value); const next = products.find((product) => product.id === event.target.value); if (!transaction && next) setPrice(decimal(next.listingPriceOre ?? next.expectedSalePriceOre ?? 0)); }} required>{available.map((product) => <option value={product.id} key={product.id}>{product.name} · {product.remainingQuantity + (transaction?.productId === product.id ? transaction.quantity : 0)} {t("available")}</option>)}</select></label>}<label>{t("Quantity")}<input type="number" min="1" step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} required /></label></div><div className="track-form-grid"><label>{t(type === "PURCHASE" ? "Purchase price" : "Sale price")} <small>{t(type === "PURCHASE" ? "per unit · DKK" : "total · DKK")}</small><input inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} required /></label><label>{t("Shipping")} <small>{t("total · DKK")}</small><input inputMode="decimal" value={shipping} onChange={(event) => setShipping(event.target.value)} required /></label>{type === "PURCHASE" ? <label>{t("Supplier")}<input name="supplier" maxLength={120} defaultValue={transaction?.supplier ?? ""} placeholder={t("Supplier")} /></label> : <><label>{t("Platform")}<input name="platform" maxLength={120} defaultValue={transaction?.platform ?? ""} placeholder={t("eBay, Discord, Direct…")} required /></label><label>{t("Marketplace fees")} <small>{t("total · DKK")}</small><input inputMode="decimal" value={fee} onChange={(event) => setFee(event.target.value)} required /></label><label>{t("Promoted listing fee")} <small>{t("total · DKK")}</small><input inputMode="decimal" value={promoted} onChange={(event) => setPromoted(event.target.value)} required /></label><label>{t("Other costs")} <small>{t("total · DKK")}</small><input inputMode="decimal" value={other} onChange={(event) => setOther(event.target.value)} required /></label></>}<label>{t(type === "PURCHASE" ? "Purchase date" : "Sale date")}<input name="occurredAt" type="date" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} required /></label></div><label>{t("Transaction note")}<textarea name="notes" maxLength={2000} defaultValue={transaction?.notes ?? ""} placeholder={t("Optional context")} /></label><VatFields type={type} treatment={treatment} setTreatment={setTreatment} priceMode={priceMode} setPriceMode={setPriceMode} rate={rate} setRate={setRate} transaction={transaction} />{preview ? <div className="track-sale-preview"><span><small>{t(type === "SALE" ? "Revenue" : "Cost basis")}</small><strong>{money(type === "SALE" ? preview.revenueOre : preview.economicPurchaseCostOre)}</strong></span><span><small>{t("Input VAT")}</small><strong>{money(preview.inputVatOre)}</strong></span><span><small>{t("Output VAT")}</small><strong>{money(preview.outputVatOre)}</strong></span><span><small>{t("Deductible VAT")}</small><strong>{money(preview.deductibleVatOre)}</strong></span>{type === "SALE" ? <><span><small>{t("Net profit")}</small><strong className={preview.profitOre >= 0 ? "positive" : "negative"}>{money(preview.profitOre)}</strong></span><span><small>{t("Margin")}</small><strong>{percent(preview.profitOre, preview.revenueOre)}</strong></span></> : null}</div> : null}{error ? <p className="track-form-error" role="alert">{error}</p> : null}<footer className="track-dialog-actions"><button className="track-button-secondary" type="button" onClick={onClose}>{t("Cancel")}</button><button className="track-button-primary" type="submit" disabled={saving}>{saving ? t("Saving…") : title}</button></footer></form></Modal>;
}

function vatBadges(transaction: TrackerTransaction, t: (key: string) => string) {
  if (!transaction.vatTreatment) return [t("VAT unknown")];
  const badges = [transaction.type === "SALE" ? t("Sale") : t("Purchase")];
  if (transaction.isB2b) badges.push(t("B2B"));
  if (transaction.vatTreatment === "EU_B2B_SALE_REVERSE_CHARGE") badges.push(t("EU 0% VAT"));
  else badges.push(`${rateInput(transaction.vatRateBps)}% ${t("VAT")}`);
  return badges;
}

export function TrackerTransactions({ transactions, onCompose, onRefresh }: {
  transactions: TrackerTransaction[];
  onCompose: (type: TransactionType, transaction?: TrackerTransaction) => void; onRefresh: () => Promise<void>;
}) {
  const { t, money, date, percent } = useTrackerI18n();
  const [filter, setFilter] = useState<Filter>("ALL");
  const [deleting, setDeleting] = useState<TrackerTransaction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const visible = transactions.filter((transaction) => filter === "ALL" || transaction.type === filter);
  const counts = { ALL: transactions.length, PURCHASE: transactions.filter((item) => item.type === "PURCHASE").length, SALE: transactions.filter((item) => item.type === "SALE").length };
  async function remove() {
    if (!deleting) return;
    setError(null);
    try { await responseJson(await fetch("/api/track/transactions", { method: "DELETE", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: deleting.id }) })); setDeleting(null); await onRefresh(); }
    catch (removeError) { setError(t(removeError instanceof Error ? removeError.message : "TRACKER_REQUEST_FAILED")); setDeleting(null); }
  }
  return <><header className="track-topbar"><div><p className="track-kicker">{t("Unified ledger")}</p><h1>{t("Transactions")}</h1><p className="track-heading-detail">{t("Purchases fund inventory. Sales release profit and reduce stock automatically.")}</p></div><div className="track-header-actions"><button className="track-button-secondary" type="button" onClick={() => onCompose("PURCHASE")}>↓ {t("Purchase")}</button><button className="track-button-primary" type="button" onClick={() => onCompose("SALE")}>↗ {t("Sale")}</button></div></header>{error ? <p className="track-form-error track-section-error" role="alert">{error}</p> : null}<div className="track-transaction-tabs" role="tablist" aria-label={t("Filter transactions")}>{(["ALL", "PURCHASE", "SALE"] as const).map((item) => <button role="tab" aria-selected={filter === item} className={filter === item ? "active" : ""} type="button" onClick={() => setFilter(item)} key={item}>{t(item === "ALL" ? "All" : item === "PURCHASE" ? "Purchases" : "Sales")}<span>{counts[item]}</span></button>)}</div><section className="track-table-panel">{visible.length ? <div className="track-transaction-list">{visible.map((transaction) => <article className="track-transaction-v2" key={transaction.id}><div className={`track-transaction-type ${transaction.type.toLowerCase()}`}><span>{transaction.type === "SALE" ? "↗" : "↓"}</span><small>{t(transaction.type === "SALE" ? "Sale" : "Purchase")}</small></div><div className="track-transaction-product"><strong>{transaction.productName}</strong><small>{transaction.type === "SALE" ? transaction.platform : transaction.supplier || t("Purchase")} · {date(transaction.occurredAt)}</small><div className="track-vat-badges">{vatBadges(transaction, t).map((badge) => <span key={badge}>{badge}</span>)}</div></div><div><small>{t("Units")}</small><strong>{transaction.quantity}</strong></div><div><small>{t(transaction.type === "SALE" ? "Revenue" : "Purchase")}</small><strong>{money(transaction.type === "SALE" ? transaction.revenueOre : transaction.totalCostsOre)}</strong></div><div><small>{t("VAT")}</small><strong>{money(transaction.type === "SALE" ? transaction.outputVatOre ?? 0 : transaction.deductibleVatOre ?? 0)}</strong></div><div className="track-transaction-result"><small>{t(transaction.type === "SALE" ? "Net profit" : "Cash out")}</small><strong className={transaction.type === "SALE" ? transaction.netProfitOre >= 0 ? "positive" : "negative" : ""}>{transaction.type === "SALE" ? money(transaction.netProfitOre) : `−${money(transaction.grossAmountOre ?? transaction.totalCostsOre)}`}</strong>{transaction.type === "SALE" ? <span>{percent(transaction.netProfitOre, transaction.revenueOre)} {t("Margin")} · {percent(transaction.netProfitOre, transaction.costBasisOre)} {t("ROI")}</span> : null}</div><div className="track-row-actions"><button type="button" onClick={() => onCompose(transaction.type, transaction)}>{t("Edit")}</button><button type="button" className="danger" onClick={() => setDeleting(transaction)}>{t("Delete")}</button></div></article>)}</div> : <div className="track-empty-state"><span>00</span><strong>{t("No transactions in this view")}</strong><p>{t("Record a purchase to add stock, or a sale to realise profit.")}</p></div>}</section>{deleting ? <Modal title={t("Delete transaction?")} kicker={t("Permanent ledger change")} onClose={() => setDeleting(null)}><div className="track-delete-copy"><p><strong>{deleting.productName}</strong><br />{t("This recalculates inventory, cost basis, profit, ROI and VAT. It cannot be undone.")}</p></div><footer className="track-dialog-actions"><button className="track-button-secondary" type="button" onClick={() => setDeleting(null)}>{t("Keep transaction")}</button><button className="track-button-danger" type="button" onClick={() => void remove()}>{t("Delete transaction")}</button></footer></Modal> : null}</>;
}
