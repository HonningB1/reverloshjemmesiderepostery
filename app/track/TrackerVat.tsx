"use client";

import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { useTrackerI18n } from "./i18n";
import type { TrackerVatSettlement, VatData } from "./types";

type VatDialog = { kind: "settlement"; settlement?: TrackerVatSettlement } | { kind: "delete"; settlement: TrackerVatSettlement } | null;

function dkkToOre(value: FormDataEntryValue | null) {
  const match = String(value ?? "").trim().replace(/\s/g, "").replace(",", ".").match(/^(\d{1,10})(?:\.(\d{0,2}))?$/);
  if (!match) return null;
  const amount = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(amount) && amount > 0 && amount <= 100_000_000_000 ? amount : null;
}

async function responseJson<T>(response: Response) {
  const value = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(value.error ?? "The tracker request failed.");
  return value;
}

function localDate() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function VatModal({ title, kicker, children, onClose }: { title: string; kicker: string; children: ReactNode; onClose: () => void }) {
  const { t } = useTrackerI18n();
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", close); document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", close); document.body.style.overflow = ""; };
  }, [onClose]);
  return <div className="track-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="track-dialog" role="dialog" aria-modal="true" aria-labelledby="vat-dialog-title"><header><div><p className="track-kicker">{kicker}</p><h2 id="vat-dialog-title">{title}</h2></div><button type="button" className="track-dialog-close" onClick={onClose} aria-label={t("Close dialog")}>×</button></header>{children}</section></div>;
}

function SettlementForm({ settlement, onClose, onSaved }: { settlement?: TrackerVatSettlement; onClose: () => void; onSaved: () => Promise<void> }) {
  const { t } = useTrackerI18n();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null);
    const values = new FormData(event.currentTarget);
    const amountOre = dkkToOre(values.get("amount"));
    if (amountOre === null) { setError(t("Use whole units and valid DKK amounts with no more than two decimals.")); return; }
    setSaving(true);
    try {
      await responseJson(await fetch("/api/track/vat", {
        method: settlement ? "PATCH" : "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: settlement?.id, direction: values.get("direction"), amountOre, occurredAt: values.get("occurredAt"), reference: values.get("reference"), notes: values.get("notes") }),
      }));
      await onSaved(); onClose();
    } catch (submitError) { setError(submitError instanceof Error ? submitError.message : t("The tracker request failed.")); }
    finally { setSaving(false); }
  }
  return <form className="track-form" onSubmit={submit}><div className="track-form-grid"><label>{t("Direction")}<select name="direction" defaultValue={settlement?.direction ?? "PAID"}><option value="PAID">{t("Paid")}</option><option value="RECEIVED">{t("Received")}</option></select></label><label>{t("Amount")} <small>DKK</small><input name="amount" inputMode="decimal" defaultValue={settlement ? (settlement.amountOre / 100).toFixed(2) : ""} placeholder="0,00" required /></label><label>{t("Settlement date")}<input name="occurredAt" type="date" defaultValue={settlement?.occurredAt ?? localDate()} required /></label><label>{t("Reference")}<input name="reference" maxLength={120} defaultValue={settlement?.reference} placeholder="Momsperiode / reference" /></label></div><label>{t("Note")}<textarea name="notes" maxLength={2000} defaultValue={settlement?.notes} placeholder={t("Optional context")} /></label><p className="track-form-note">{t("VAT settlements reduce the open VAT position and never affect profit.")}</p>{error ? <p className="track-form-error" role="alert">{error}</p> : null}<footer className="track-dialog-actions"><button className="track-button-secondary" type="button" onClick={onClose}>{t("Cancel")}</button><button className="track-button-primary" type="submit" disabled={saving}>{saving ? t("Saving…") : t("Save settlement")}</button></footer></form>;
}

export function TrackerVat({ data, onRefresh }: { data: VatData; onRefresh: () => Promise<void> }) {
  const { t, money, date } = useTrackerI18n();
  const [dialog, setDialog] = useState<VatDialog>(null);
  const [error, setError] = useState<string | null>(null);
  async function remove(id: string) {
    setError(null);
    try {
      await responseJson(await fetch("/api/track/vat", { method: "DELETE", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }));
      setDialog(null); await onRefresh();
    } catch (removeError) { setError(removeError instanceof Error ? removeError.message : t("The tracker request failed.")); setDialog(null); }
  }
  const positionLabel = data.totals.openPositionOre > 0 ? t("VAT receivable") : data.totals.openPositionOre < 0 ? t("VAT payable") : t("Open position");
  return <><header className="track-topbar"><div><p className="track-kicker">{t("VAT ledger")}</p><h1>{t("VAT")}</h1><p className="track-heading-detail">{t("Input and output VAT, deductions and actual settlements.")}</p></div><div className="track-header-actions"><button className="track-button-primary" type="button" onClick={() => setDialog({ kind: "settlement" })}>＋ {t("Record settlement")}</button></div></header>
    {error ? <p className="track-form-error track-section-error" role="alert">{error}</p> : null}
    <div className="track-vat-summary"><article><span>01</span><small>{t("Input VAT recorded")}</small><strong>{money(data.totals.inputVatOre)}</strong></article><article><span>02</span><small>{t("Deductible input VAT")}</small><strong>{money(data.totals.deductibleInputVatOre)}</strong></article><article><span>03</span><small>{t("Output VAT due")}</small><strong>{money(data.totals.outputVatOre)}</strong></article><article className={data.totals.openPositionOre < 0 ? "payable" : "receivable"}><span>04</span><small>{positionLabel}</small><strong>{money(Math.abs(data.totals.openPositionOre))}</strong></article></div>
    <div className="track-vat-bridge"><div><span>{t("Deductible input VAT")}</span><strong>＋ {money(data.totals.deductibleInputVatOre)}</strong></div><div><span>{t("Output VAT due")}</span><strong>− {money(data.totals.outputVatOre)}</strong></div><div><span>{t("Received")}</span><strong>− {money(data.totals.receivedSettlementsOre)}</strong></div><div><span>{t("Paid")}</span><strong>＋ {money(data.totals.paidSettlementsOre)}</strong></div></div>
    <section className="track-table-panel track-expense-section"><div className="track-panel-heading"><div><p className="track-kicker">{t("VAT position")}</p><h2>{t("Settlements")}</h2></div><span>{data.settlements.length}</span></div>{data.settlements.length ? <div className="track-table-scroll"><table className="track-data-table track-vat-table"><thead><tr><th>{t("Direction")}</th><th>{t("Date")}</th><th>{t("Reference")}</th><th>{t("Note")}</th><th>{t("Amount")}</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{data.settlements.map((settlement) => <tr key={settlement.id}><td><span className={`track-vat-direction ${settlement.direction.toLowerCase()}`}>{t(settlement.direction === "PAID" ? "Paid" : "Received")}</span></td><td><strong>{date(settlement.occurredAt)}</strong></td><td><small>{settlement.reference || "—"}</small></td><td><small>{settlement.notes || "—"}</small></td><td><strong>{settlement.direction === "PAID" ? "−" : "＋"}{money(settlement.amountOre)}</strong></td><td><div className="track-row-actions"><button type="button" onClick={() => setDialog({ kind: "settlement", settlement })}>{t("Edit")}</button><button type="button" className="danger" onClick={() => setDialog({ kind: "delete", settlement })}>{t("Delete")}</button></div></td></tr>)}</tbody></table></div> : <div className="track-empty-state"><span>00</span><strong>{t("No VAT settlements")}</strong><p>{t("Record only money actually paid to or received from the tax authority.")}</p></div>}</section>
    {dialog?.kind === "settlement" ? <VatModal title={dialog.settlement ? t("Edit VAT settlement") : t("Record settlement")} kicker={t("VAT position")} onClose={() => setDialog(null)}><SettlementForm settlement={dialog.settlement} onClose={() => setDialog(null)} onSaved={onRefresh} /></VatModal> : null}
    {dialog?.kind === "delete" ? <VatModal title={t("Delete VAT settlement?")} kicker={t("Permanent ledger change")} onClose={() => setDialog(null)}><div className="track-delete-copy"><p>{t("VAT settlements reduce the open VAT position and never affect profit.")}</p></div><footer className="track-dialog-actions"><button className="track-button-secondary" type="button" onClick={() => setDialog(null)}>{t("Keep settlement")}</button><button className="track-button-danger" type="button" onClick={() => void remove(dialog.settlement.id)}>{t("Delete settlement")}</button></footer></VatModal> : null}
  </>;
}
