"use client";

import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { calculatePrivateAmounts, calculateVatAmounts, priceModeForTransactionContext, recalculateOperationalProductSales, recalculateProductSales } from "../../lib/tracker-accounting";
import { effectiveTransactionContext } from "../../lib/tracker-context";
import { useTrackerI18n } from "./i18n";
import { vatTreatments, type PriceMode, type PurchasePurpose, type TrackerProduct, type TrackerTransaction, type TransactionContext, type TransactionType, type VatTreatment } from "./types";

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

function VatFields({ type, treatment, setTreatment: updateTreatment, priceMode, setPriceMode, rate, setRate, transaction, transactionContext }: {
  type: TransactionType; treatment: VatTreatment | ""; setTreatment: (value: VatTreatment | "") => void;
  priceMode: PriceMode; setPriceMode: (value: PriceMode) => void; rate: string; setRate: (value: string) => void;
  transaction?: TrackerTransaction; transactionContext: TransactionContext;
}) {
  const { t } = useTrackerI18n();
  const [open, setOpen] = useState(!transaction?.vatTreatment);
  if (transactionContext === "PRIVATE") return null;
  function setTreatment(value: VatTreatment | "") {
    updateTreatment(value);
    if (value === "DANISH_PURCHASE_DEDUCTIBLE" || value === "DANISH_SALE_VAT" || value === "EU_PURCHASE_REVERSE_CHARGE") setRate("25");
    if (value === "EU_B2B_SALE_REVERSE_CHARGE" || value === "NO_VAT_OUTSIDE_SCOPE") setRate("0");
  }
  return <fieldset className="track-vat-fields"><button type="button" className="track-vat-toggle" onClick={() => setOpen((value) => !value)} aria-expanded={open}><span>{open ? "−" : "+"}</span>{t(open ? "Hide VAT details" : "Advanced VAT details")}</button>{open ? <div className="track-vat-fields-body"><div className="track-form-grid"><label>{t("VAT treatment")}<select name="vatTreatment" value={treatment} onChange={(event) => setTreatment(event.target.value as VatTreatment)}>{allowedTreatments(type).map((value) => <option value={value} key={value}>{t(treatmentLabels[value])}</option>)}</select></label><label>{t("Price basis")}<select name="priceMode" value={priceMode} onChange={(event) => setPriceMode(event.target.value as PriceMode)} disabled={transactionContext === "PRIVATE"}><option value="VAT_EXCLUSIVE">{t("VAT exclusive")}</option><option value="VAT_INCLUSIVE">{t("VAT inclusive")}</option></select></label><label>{t("VAT rate")} <small>%</small><input name="vatRate" inputMode="decimal" value={rate} onChange={(event) => setRate(event.target.value)} /></label>{type === "PURCHASE" ? <label>{t("Supplier country")} <small>ISO 3166-1</small><input name="supplierCountry" defaultValue={transaction?.supplierCountry ?? ""} maxLength={2} placeholder="DK" /></label> : <><label>{t("Customer country")} <small>ISO 3166-1</small><input name="customerCountry" defaultValue={transaction?.customerCountry ?? ""} maxLength={2} placeholder="DE" /></label><label>{t("VAT ID reference")}<input name="vatIdReference" defaultValue={transaction?.vatIdReference ?? ""} maxLength={80} placeholder="DE123456789" /></label><label className="track-checkbox-field">{t("Customer type")}<span className="track-checkbox-control"><input name="isB2b" type="checkbox" defaultChecked={Boolean(transaction?.isB2b)} /><span>{t("Business customer (B2B)")}</span></span></label></>}</div>{treatment === "CUSTOM_MANUAL" ? <div className="track-form-grid track-vat-manual">{type === "PURCHASE" ? <><label>{t("Input VAT")} <small>DKK</small><input name="inputVat" inputMode="decimal" defaultValue={oreInput(transaction?.inputVatOre)} required /></label><label>{t("Deductible VAT")} <small>DKK</small><input name="deductibleVat" inputMode="decimal" defaultValue={oreInput(transaction?.deductibleVatOre)} required /></label></> : null}<label>{t("Output VAT")} <small>DKK</small><input name="outputVat" inputMode="decimal" defaultValue={oreInput(transaction?.outputVatOre)} required /></label></div> : null}</div> : null}</fieldset>;
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
  const [purchasePurpose, setPurchasePurpose] = useState<PurchasePurpose>("INVENTORY");
  const initialTransactionContext = transaction?.transactionContext ?? "PRIVATE";
  const [transactionContext, setTransactionContext] = useState<TransactionContext>(initialTransactionContext);
  const [priceMode, setPriceMode] = useState<PriceMode>(priceModeForTransactionContext(initialTransactionContext, transaction?.priceMode) ?? "VAT_EXCLUSIVE");
  const [treatment, setTreatment] = useState<VatTreatment | "">(initialTransactionContext === "PRIVATE" ? "" : transaction?.vatTreatment ?? "");
  const [rate, setRate] = useState(initialTransactionContext === "PRIVATE" ? "0" : transaction?.vatRateBps === null || transaction?.vatRateBps === undefined ? "0" : rateInput(transaction.vatRateBps));
  const [occurredAt, setOccurredAt] = useState(transaction?.occurredAt ?? localDate());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const preview = useMemo(() => {
    const parsedQuantity = Number(quantity); const enteredPriceOre = dkkToOre(price); const enteredShippingOre = dkkToOre(shipping);
    const feeOre = dkkToOre(fee); const promotedFeeOre = dkkToOre(promoted); const otherCostsOre = dkkToOre(other); const vatRateBps = percentToBps(rate);
    if ((transactionContext !== "PRIVATE" && !treatment) || !selected && type === "SALE" || !Number.isSafeInteger(parsedQuantity) || parsedQuantity < 1 || enteredPriceOre === null || enteredShippingOre === null || feeOre === null || promotedFeeOre === null || otherCostsOre === null || transactionContext !== "PRIVATE" && (vatRateBps === null || treatment === "CUSTOM_MANUAL")) return null;
    const capacity = selected ? selected.remainingQuantity + (transaction?.productId === selected.id ? transaction.quantity : 0) : parsedQuantity;
    if (type === "SALE" && parsedQuantity > capacity) return null;
    try {
      const enteredUnitPriceOre = type === "SALE" ? Math.round(enteredPriceOre / parsedQuantity) : enteredPriceOre;
      const amounts = transactionContext === "PRIVATE"
        ? calculatePrivateAmounts({ type, quantity: parsedQuantity, enteredUnitPriceOre, enteredShippingOre,
          enteredTotalPriceOre: type === "SALE" ? enteredPriceOre : null })
        : calculateVatAmounts({ type, quantity: parsedQuantity, enteredUnitPriceOre, enteredShippingOre,
          enteredTotalPriceOre: type === "SALE" ? enteredPriceOre : null, priceMode, vatTreatment: treatment as VatTreatment, vatRateBps: vatRateBps! });
      if (type === "PURCHASE") return { ...amounts, costBasisOre: amounts.economicPurchaseCostOre, totalCostsOre: amounts.economicPurchaseCostOre, profitOre: 0 };
      const candidateId = transaction?.id ?? "__preview__";
      const otherSales = transactions.filter((item) => item.type === "SALE" && item.productId === selected!.id && item.id !== transaction?.id)
        .map((item) => ({ id: item.id, quantity: item.quantity, revenueOre: item.revenueOre, feeOre: item.feeOre,
          promotedFeeOre: item.promotedFeeOre, shippingOre: item.shippingOre, otherCostsOre: item.otherCostsOre,
          grossRevenueOre: item.grossAmountOre, transactionContext: item.transactionContext,
          occurredAt: item.occurredAt, createdAt: item.createdAt }));
      const ledger = recalculateProductSales(selected!, [...otherSales, { id: candidateId, quantity: parsedQuantity,
        revenueOre: amounts.revenueOre, feeOre, promotedFeeOre, shippingOre: enteredShippingOre, otherCostsOre,
        occurredAt, createdAt: transaction?.createdAt ?? "9999" }]);
      const operationalLedger = recalculateOperationalProductSales(selected!, [...otherSales, { id: candidateId, quantity: parsedQuantity,
        revenueOre: amounts.revenueOre, grossRevenueOre: amounts.grossAmountOre, transactionContext, feeOre, promotedFeeOre,
        shippingOre: enteredShippingOre, otherCostsOre, occurredAt, createdAt: transaction?.createdAt ?? "9999" }]);
      const previewSale = ledger.sales.find((item) => item.id === candidateId)!;
      const operationalSale = operationalLedger.sales.find((item) => item.id === candidateId)!;
      return { ...amounts, costBasisOre: previewSale.costBasisOre, totalCostsOre: previewSale.totalCostsOre, profitOre: previewSale.netProfitOre,
        operationalCostBasisOre: operationalSale.operationalCostBasisOre, operationalTotalCostsOre: operationalSale.operationalTotalCostsOre,
        operationalProfitOre: operationalSale.operationalProfitOre };
    } catch { return null; }
  }, [fee, occurredAt, other, price, priceMode, promoted, quantity, rate, selected, shipping, transaction, transactionContext, transactions, treatment, type]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null);
    const values = new FormData(event.currentTarget);
    const parsedQuantity = Number(quantity); const enteredPriceOre = dkkToOre(price); const shippingOre = dkkToOre(shipping);
    const feeOre = dkkToOre(fee); const promotedFeeOre = dkkToOre(promoted); const otherCostsOre = dkkToOre(other); const vatRateBps = percentToBps(rate);
    const inputVatOre = treatment === "CUSTOM_MANUAL" ? dkkToOre(values.get("inputVat")) : null;
    const outputVatOre = treatment === "CUSTOM_MANUAL" ? dkkToOre(values.get("outputVat")) : null;
    const deductibleVatOre = treatment === "CUSTOM_MANUAL" ? dkkToOre(values.get("deductibleVat")) : null;
    if ((transactionContext !== "PRIVATE" && (!treatment || vatRateBps === null ||
      treatment === "CUSTOM_MANUAL" && (outputVatOre === null || type === "PURCHASE" && (inputVatOre === null || deductibleVatOre === null)))) ||
      !Number.isSafeInteger(parsedQuantity) || parsedQuantity < 1 || enteredPriceOre === null || shippingOre === null || feeOre === null || promotedFeeOre === null || otherCostsOre === null) {
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
          priceMode: transactionContext === "PRIVATE" ? null : priceMode, vatTreatment: transactionContext === "PRIVATE" ? null : treatment,
          vatRateBps: transactionContext === "PRIVATE" ? null : vatRateBps, inputVatOre: transactionContext === "PRIVATE" ? null : inputVatOre,
          outputVatOre: transactionContext === "PRIVATE" ? null : outputVatOre, deductibleVatOre: transactionContext === "PRIVATE" ? null : deductibleVatOre,
          transactionContext,
          supplierCountry: values.get("supplierCountry"), customerCountry: values.get("customerCountry"),
          isB2b: values.get("isB2b") === "on", vatIdReference: values.get("vatIdReference"),
        }),
      }));
      await onSaved(); onClose();
    } catch (submitError) { setError(t(submitError instanceof Error ? submitError.message : "TRACKER_REQUEST_FAILED")); }
    finally { setSaving(false); }
  }

  async function submitSubscription(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null); const values = new FormData(event.currentTarget); const amountOre = dkkToOre(price); const vatRateBps = percentToBps(rate);
    const inputVatOre = treatment === "CUSTOM_MANUAL" ? dkkToOre(values.get("inputVat")) : null; const outputVatOre = treatment === "CUSTOM_MANUAL" ? dkkToOre(values.get("outputVat")) : null; const deductibleVatOre = treatment === "CUSTOM_MANUAL" ? dkkToOre(values.get("deductibleVat")) : null;
    if (amountOre === null || (transactionContext !== "PRIVATE" && (!treatment || vatRateBps === null || treatment === "CUSTOM_MANUAL" && (inputVatOre === null || outputVatOre === null || deductibleVatOre === null)))) { setError(t("Check the quantity and DKK amounts before saving.")); return; }
    setSaving(true); try {
      await responseJson(await fetch("/api/track/subscriptions", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        name: values.get("name"), costOre: amountOre, category: values.get("category"), billingPeriod: values.get("billingPeriod"), nextPaymentDate: values.get("nextPaymentDate"), autoRenew: values.get("autoRenew") === "on", status: "ACTIVE", notes: values.get("notes"),
        initialPayment: { amountOre, occurredAt, notes: values.get("notes"), supplierCountry: values.get("supplierCountry"), transactionContext,
          priceMode: transactionContext === "PRIVATE" ? null : priceMode, vatTreatment: transactionContext === "PRIVATE" ? null : treatment,
          vatRateBps: transactionContext === "PRIVATE" ? null : vatRateBps, inputVatOre: transactionContext === "PRIVATE" ? null : inputVatOre,
          outputVatOre: transactionContext === "PRIVATE" ? null : outputVatOre, deductibleVatOre: transactionContext === "PRIVATE" ? null : deductibleVatOre },
      }) })); await onSaved(); onClose();
    } catch (submitError) { setError(t(submitError instanceof Error ? submitError.message : "TRACKER_REQUEST_FAILED")); } finally { setSaving(false); }
  }

  const title = transaction ? t("Update transaction") : t(type === "PURCHASE" ? "Record purchase" : "Record sale");
  if (type === "SALE" && !available.length) return <Modal title={title} kicker={t("Unified ledger")} onClose={onClose}><div className="track-dialog-empty"><div className="track-empty-state"><span>00</span><strong>{t("No sellable inventory")}</strong><p>{t("Add a purchase or inventory item before recording a sale.")}</p></div><footer className="track-dialog-actions"><button className="track-button-secondary" type="button" onClick={onClose}>{t("Close")}</button></footer></div></Modal>;
  function chooseContext(next: TransactionContext) { setTransactionContext(next); if (next === "PRIVATE") { setPriceMode("VAT_INCLUSIVE"); setTreatment(""); setRate("0"); } else { setTreatment(""); setRate("0"); } }
  if (type === "PURCHASE" && purchasePurpose === "SUBSCRIPTION") return <Modal title={t("Record subscription")} kicker={t("Subscription")} onClose={onClose} wide><form className="track-form" onSubmit={submitSubscription}><div className="track-form-grid"><label>{t("Purchase type")}<select value={purchasePurpose} onChange={(event) => setPurchasePurpose(event.target.value as PurchasePurpose)}><option value="INVENTORY">{t("Inventory purchase")}</option><option value="SUBSCRIPTION">{t("Subscription")}</option></select></label><label>{t("Transaction context")}<select value={transactionContext} onChange={(event) => chooseContext(event.target.value as TransactionContext)}><option value="PRIVATE">{t("Private / B2C")}</option><option value="B2B">{t("B2B")}</option><option value="SPECIAL">{t("Special VAT treatment")}</option></select></label></div><div className="track-form-grid"><label>{t("Name")}<input name="name" maxLength={160} required /></label><label>{t("Category")}<select name="category"><option>Software</option><option>Services</option><option>Other</option></select></label><label>{t("Billing period")}<select name="billingPeriod"><option value="MONTHLY">{t("Monthly")}</option><option value="YEARLY">{t("Yearly")}</option><option value="CUSTOM">{t("Custom")}</option></select></label><label>{t("Next payment")}<input name="nextPaymentDate" type="date" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} required /></label><label>{t("Purchase price")} <small>{t("total · DKK")}</small><input inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} required /></label></div><label className="track-checkbox-field">{t("Auto-renew")}<span className="track-checkbox-control"><input name="autoRenew" type="checkbox" /><span>{t("Review before enabling")}</span></span></label><label>{t("Transaction note")}<textarea name="notes" maxLength={2000} /></label><VatFields type="PURCHASE" treatment={treatment} setTreatment={setTreatment} priceMode={priceMode} setPriceMode={setPriceMode} rate={rate} setRate={setRate} transactionContext={transactionContext} />{error ? <p className="track-form-error" role="alert">{error}</p> : null}<footer className="track-dialog-actions"><button className="track-button-secondary" type="button" onClick={onClose}>{t("Cancel")}</button><button className="track-button-primary" type="submit" disabled={saving}>{t(saving ? "Saving…" : "Record subscription")}</button></footer></form></Modal>;
  const privatePreview = type === "SALE" && transactionContext === "PRIVATE" ? <div className="track-sale-preview"><span><small>{t("Sale price")}</small><strong>{money(preview?.grossAmountOre ?? 0)}</strong></span><span><small>{t("Cost of goods sold")}</small><strong>{money(preview?.operationalCostBasisOre ?? 0)}</strong></span><span><small>{t("Sale expenses")}</small><strong>{money((preview?.operationalTotalCostsOre ?? 0) - (preview?.operationalCostBasisOre ?? 0))}</strong></span><span><small>{t("Sale profit")}</small><strong className={(preview?.operationalProfitOre ?? 0) >= 0 ? "positive" : "negative"}>{money(preview?.operationalProfitOre ?? 0)}</strong><small>{percent(preview?.operationalProfitOre ?? 0, preview?.grossAmountOre ?? 0)} {t("Margin")}</small></span></div> : null;
  const privatePurchasePreview = type === "PURCHASE" && transactionContext === "PRIVATE" ? <div className="track-sale-preview"><span><small>{t("Purchase price")}</small><strong>{money(preview?.economicPurchaseCostOre ?? 0)}</strong></span></div> : null;
  const vatPreview = preview ? type === "SALE" ? <div className="track-sale-preview"><span><small>{t("Revenue")}</small><strong>{money(preview.revenueOre)}</strong></span><span><small>{t("Output VAT")}</small><strong>{money(preview.outputVatOre)}</strong></span><span><small>{t("Cost of goods sold")}</small><strong>{money(preview.costBasisOre)}</strong></span><span><small>{t("Sale expenses")}</small><strong>{money(preview.totalCostsOre - preview.costBasisOre)}</strong></span><span><small>{t("Sale profit")}</small><strong className={preview.profitOre >= 0 ? "positive" : "negative"}>{money(preview.profitOre)}</strong><small>{percent(preview.profitOre, preview.revenueOre)} {t("Margin")}</small></span></div> : <div className="track-sale-preview"><span><small>{t("Cost basis")}</small><strong>{money(preview.economicPurchaseCostOre)}</strong></span><span><small>{t("Input VAT")}</small><strong>{money(preview.inputVatOre)}</strong></span><span><small>{t("Output VAT")}</small><strong>{money(preview.outputVatOre)}</strong></span><span><small>{t("Deductible VAT")}</small><strong>{money(preview.deductibleVatOre)}</strong></span></div> : null;
  return <Modal title={title} kicker={t(type === "PURCHASE" ? "Purchase" : "Sale")} onClose={onClose} wide><form className="track-form" onSubmit={submit}><div className="track-form-grid">{type === "PURCHASE" ? <label>{t("Purchase type")}<select value={purchasePurpose} onChange={(event) => setPurchasePurpose(event.target.value as PurchasePurpose)}><option value="INVENTORY">{t("Inventory purchase")}</option><option value="SUBSCRIPTION">{t("Subscription")}</option></select></label> : null}<label>{t("Transaction context")}<select value={transactionContext} onChange={(event) => chooseContext(event.target.value as TransactionContext)}><option value="PRIVATE">{t("Private / B2C")}</option><option value="B2B">{t("B2B")}</option><option value="SPECIAL">{t("Special VAT treatment")}</option></select></label></div><div className="track-form-grid track-form-grid-main">{type === "PURCHASE" ? <label className="track-field-wide">{t("Product name")}<input name="name" defaultValue={transaction?.productName} maxLength={160} placeholder="Starlink Mini" required /></label> : <label className="track-field-wide">{t("Inventory item")}<select value={selectedId} onChange={(event) => { setSelectedId(event.target.value); const next = products.find((product) => product.id === event.target.value); if (!transaction && next) setPrice(decimal(next.listingPriceOre ?? next.expectedSalePriceOre ?? 0)); }} required>{available.map((product) => <option value={product.id} key={product.id}>{product.name} · {product.remainingQuantity + (transaction?.productId === product.id ? transaction.quantity : 0)} {t("available")}</option>)}</select></label>}<label>{t("Quantity")}<input type="number" min="1" step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} required /></label></div><div className="track-form-grid"><label>{t(type === "PURCHASE" ? "Purchase price" : "Sale price")} <small>{t(type === "PURCHASE" ? "per unit · DKK" : "total · DKK")}</small><input inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} required /></label><label>{t(type === "PURCHASE" ? "Shipping" : "Seller-paid shipping")} <small>{t(type === "PURCHASE" ? "total · DKK" : "Sale shipping is paid by you and reduces profit.")}</small><input inputMode="decimal" value={shipping} onChange={(event) => setShipping(event.target.value)} required /></label>{type === "PURCHASE" ? <label>{t("Supplier")}<input name="supplier" maxLength={120} defaultValue={transaction?.supplier ?? ""} placeholder={t("Supplier")} /></label> : <><label>{t("Platform")}<input name="platform" maxLength={120} defaultValue={transaction?.platform ?? ""} placeholder={t("eBay, Discord, Direct…")} required /></label><label>{t("Marketplace fees")} <small>{t("total · DKK")}</small><input inputMode="decimal" value={fee} onChange={(event) => setFee(event.target.value)} required /></label><label>{t("Promoted listing fee")} <small>{t("total · DKK")}</small><input inputMode="decimal" value={promoted} onChange={(event) => setPromoted(event.target.value)} required /></label><label>{t("Other costs")} <small>{t("total · DKK")}</small><input inputMode="decimal" value={other} onChange={(event) => setOther(event.target.value)} required /></label></>}<label>{t(type === "PURCHASE" ? "Purchase date" : "Sale date")}<input name="occurredAt" type="date" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} required /></label></div><label>{t("Transaction note")}<textarea name="notes" maxLength={2000} defaultValue={transaction?.notes ?? ""} placeholder={t("Optional context")} /></label><VatFields type={type} treatment={treatment} setTreatment={setTreatment} priceMode={priceMode} setPriceMode={setPriceMode} rate={rate} setRate={setRate} transactionContext={transactionContext} transaction={transaction} />{transactionContext === "PRIVATE" ? privatePreview ?? privatePurchasePreview : vatPreview}{error ? <p className="track-form-error" role="alert">{error}</p> : null}<footer className="track-dialog-actions"><button className="track-button-secondary" type="button" onClick={onClose}>{t("Cancel")}</button><button className="track-button-primary" type="submit" disabled={saving}>{saving ? t("Saving…") : title}</button></footer></form></Modal>;
}

function vatBadges(transaction: TrackerTransaction, t: (key: string) => string) {
  const context = effectiveTransactionContext(transaction.transactionContext, transaction.isB2b);
  if (context === "PRIVATE") return [t("Private / B2C")];
  if (!transaction.vatTreatment) return [t("VAT unknown")];
  const badges = [transaction.type === "SALE" ? t("Sale") : t("Purchase")];
  if (context === "B2B") badges.push(t("B2B"));
  if (transaction.vatTreatment === "EU_B2B_SALE_REVERSE_CHARGE") badges.push(t("EU 0% VAT"));
  else badges.push(`${rateInput(transaction.vatRateBps)}% ${t("VAT")}`);
  return badges;
}

export function TransactionRow({ transaction, onEdit, onDelete }: {
  transaction: TrackerTransaction; onEdit: () => void; onDelete: () => void;
}) {
  const { t, money, date, percent } = useTrackerI18n();
  const context = effectiveTransactionContext(transaction.transactionContext, transaction.isB2b);
  const privateTransaction = context === "PRIVATE";
  const isSale = transaction.type === "SALE";
  const amountOre = isSale
    ? privateTransaction ? transaction.operationalRevenueOre : transaction.revenueOre
    : privateTransaction ? transaction.grossAmountOre ?? transaction.totalCostsOre : transaction.totalCostsOre;
  const amountLabel = isSale
    ? privateTransaction ? "Sale price" : "Revenue"
    : privateTransaction ? "Purchase price" : "Purchase";
  const vatOre = isSale ? transaction.outputVatOre ?? 0 : transaction.deductibleVatOre ?? 0;
  const secondaryVat = !privateTransaction && transaction.vatTreatment
    ? `${t("VAT")} ${money(vatOre)}` : null;
  return <article className="track-transaction-v2">
    <div className="track-transaction-identity">
      <div className={`track-transaction-type ${transaction.type.toLowerCase()}`}><span>{isSale ? "↗" : "↓"}</span><small>{t(isSale ? "Sale" : "Purchase")}</small></div>
      <div className="track-transaction-product"><strong>{transaction.productName}</strong><small>{isSale ? transaction.platform : transaction.supplier || t("Purchase")} · {date(transaction.occurredAt)}</small><div className="track-vat-badges">{vatBadges(transaction, t).map((badge) => <span key={badge}>{badge}</span>)}</div></div>
    </div>
    <div className="track-transaction-units"><small>{t("Units")}</small><strong>{transaction.quantity}</strong></div>
    <div className="track-transaction-amount"><small>{t(amountLabel)}</small><strong>{money(amountOre)}</strong>{secondaryVat ? <span className="track-transaction-vat-meta">{secondaryVat}</span> : null}</div>
    <div className="track-transaction-result"><small>{t(isSale ? "Sale profit" : "Cash out")}</small><strong className={isSale ? transaction.operationalProfitOre >= 0 ? "positive" : "negative" : ""}>{isSale ? money(transaction.operationalProfitOre) : `−${money(transaction.grossAmountOre ?? transaction.totalCostsOre)}`}</strong>{isSale ? <span>{percent(transaction.operationalProfitOre, transaction.operationalRevenueOre)} {t("Margin")} · {percent(transaction.operationalProfitOre, transaction.operationalCostBasisOre)} {t("ROI")}</span> : null}</div>
    <div className="track-row-actions"><button type="button" onClick={onEdit}>{t("Edit")}</button><button type="button" className="danger" onClick={onDelete}>{t("Delete")}</button></div>
  </article>;
}

export function TrackerTransactions({ transactions, onCompose, onRefresh }: {
  transactions: TrackerTransaction[];
  onCompose: (type: TransactionType, transaction?: TrackerTransaction) => void; onRefresh: () => Promise<void>;
}) {
  const { t } = useTrackerI18n();
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
  return <><header className="track-topbar"><div><p className="track-kicker">{t("Unified ledger")}</p><h1>{t("Transactions")}</h1><p className="track-heading-detail">{t("Purchases fund inventory. Sales release profit and reduce stock automatically.")}</p></div><div className="track-header-actions"><button className="track-button-secondary" type="button" onClick={() => onCompose("PURCHASE")}>↓ {t("Purchase")}</button><button className="track-button-primary" type="button" onClick={() => onCompose("SALE")}>↗ {t("Sale")}</button></div></header>{error ? <p className="track-form-error track-section-error" role="alert">{error}</p> : null}<div className="track-transaction-tabs" role="tablist" aria-label={t("Filter transactions")}>{(["ALL", "PURCHASE", "SALE"] as const).map((item) => <button role="tab" aria-selected={filter === item} className={filter === item ? "active" : ""} type="button" onClick={() => setFilter(item)} key={item}>{t(item === "ALL" ? "All" : item === "PURCHASE" ? "Purchases" : "Sales")}<span>{counts[item]}</span></button>)}</div><section className="track-table-panel">{visible.length ? <div className="track-transaction-list">{visible.map((transaction) => <TransactionRow key={transaction.id} transaction={transaction} onEdit={() => onCompose(transaction.type, transaction)} onDelete={() => setDeleting(transaction)} />)}</div> : <div className="track-empty-state"><span>00</span><strong>{t("No transactions in this view")}</strong><p>{t("Record a purchase to add stock, or a sale to realise profit.")}</p></div>}</section>{deleting ? <Modal title={t("Delete transaction?")} kicker={t("Permanent ledger change")} onClose={() => setDeleting(null)}><div className="track-delete-copy"><p><strong>{deleting.productName}</strong><br />{t("This recalculates inventory, cost basis, profit, ROI and VAT. It cannot be undone.")}</p></div><footer className="track-dialog-actions"><button className="track-button-secondary" type="button" onClick={() => setDeleting(null)}>{t("Keep transaction")}</button><button className="track-button-danger" type="button" onClick={() => void remove()}>{t("Delete transaction")}</button></footer></Modal> : null}</>;
}
