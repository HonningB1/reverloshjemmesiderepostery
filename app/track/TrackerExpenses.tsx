"use client";

import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import {
  billingPeriods, type BillingPeriod, type ExpensesData, type TrackerExpense,
  type TrackerSubscription, type TrackerSubscriptionPayment,
} from "./types";
import { useTrackerI18n } from "./i18n";

type ExpenseDialog =
  | { kind: "expense"; expense?: TrackerExpense }
  | { kind: "subscription"; subscription?: TrackerSubscription }
  | { kind: "payment"; subscription?: TrackerSubscription; payment?: TrackerSubscriptionPayment }
  | { kind: "delete-expense"; expense: TrackerExpense }
  | { kind: "delete-subscription"; subscription: TrackerSubscription }
  | { kind: "delete-payment"; payment: TrackerSubscriptionPayment }
  | null;

const expenseCategories = ["Software", "Proxies", "Shipping", "Services", "Other"];
const subscriptionCategories = ["Software", "Services", "Banking", "Tools", "Membership", "Other"];
function localDate() { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`; }
function dkkToOre(value: FormDataEntryValue | null) {
  const normalized = String(value ?? "").trim().replace(/\s/g, "").replace(",", ".");
  const match = normalized.match(/^(\d{1,10})(?:\.(\d{0,2}))?$/);
  if (!match) return null;
  const ore = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(ore) && ore > 0 && ore <= 100_000_000_000 ? ore : null;
}
function billingLabel(period: BillingPeriod) { return period.charAt(0) + period.slice(1).toLowerCase(); }

async function responseJson<T>(response: Response): Promise<T> {
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "The tracker request failed.");
  return payload;
}

function Modal({ title, kicker, children, onClose, wide = false }: { title: string; kicker: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const { t } = useTrackerI18n();
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", close); document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", close); document.body.style.overflow = ""; };
  }, [onClose]);
  return <div className="track-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={`track-dialog ${wide ? "track-dialog-wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby="expense-dialog-title">
      <header><div><p className="track-kicker">{t(kicker)}</p><h2 id="expense-dialog-title">{t(title)}</h2></div><button type="button" className="track-dialog-close" onClick={onClose} aria-label={t("Close dialog")}>×</button></header>{children}
    </section>
  </div>;
}

function ExpenseForm({ expense, onClose, onSaved }: { expense?: TrackerExpense; onClose: () => void; onSaved: () => Promise<void> }) {
  const { t } = useTrackerI18n();
  const [error, setError] = useState<string | null>(null); const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null); const values = new FormData(event.currentTarget); const amountOre = dkkToOre(values.get("amount"));
    if (amountOre === null) { setError(t("Use whole units and valid DKK amounts with no more than two decimals.")); return; }
    setSaving(true);
    try {
      await responseJson(await fetch("/api/track/expenses", {
        method: expense ? "PATCH" : "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: expense?.id, name: values.get("name"), amountOre, category: values.get("category"), occurredAt: values.get("occurredAt"), notes: values.get("notes") }),
      }));
      await onSaved(); onClose();
    } catch (submitError) { setError(t(submitError instanceof Error ? submitError.message : "The tracker request failed.")); }
    finally { setSaving(false); }
  }
  return <form className="track-form" onSubmit={submit}>
    <div className="track-form-grid track-form-grid-main"><label className="track-field-wide">{t("Name")}<input name="name" maxLength={160} defaultValue={expense?.name} placeholder="e.g. Residential proxies" required /></label><label>{t("Amount")} <small>DKK</small><input name="amount" inputMode="decimal" defaultValue={expense ? (expense.amountOre / 100).toFixed(2) : ""} placeholder="0,00" required /></label></div>
    <div className="track-form-grid"><label>{t("Category")}<input name="category" list="expense-category-options" maxLength={80} defaultValue={expense?.category} placeholder="Choose or type a category" required /><datalist id="expense-category-options">{expenseCategories.map((category) => <option value={category} key={category} />)}</datalist></label><label>{t("Date")}<input name="occurredAt" type="date" defaultValue={expense?.occurredAt ?? localDate()} required /></label></div>
    <label>{t("Note")}<textarea name="notes" maxLength={2000} defaultValue={expense?.notes} placeholder={t("Optional context")} /></label>
    {error ? <p className="track-form-error" role="alert">{error}</p> : null}
    <footer className="track-dialog-actions"><button type="button" className="track-button-secondary" onClick={onClose}>{t("Cancel")}</button><button type="submit" className="track-button-primary" disabled={saving}>{t(saving ? "Saving…" : expense ? "Save expense" : "Add expense")}</button></footer>
  </form>;
}

function SubscriptionForm({ subscription, onClose, onSaved }: { subscription?: TrackerSubscription; onClose: () => void; onSaved: () => Promise<void> }) {
  const { t } = useTrackerI18n();
  const [error, setError] = useState<string | null>(null); const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null); const values = new FormData(event.currentTarget); const costOre = dkkToOre(values.get("cost"));
    if (costOre === null) { setError(t("Use whole units and valid DKK amounts with no more than two decimals.")); return; }
    setSaving(true);
    try {
      await responseJson(await fetch("/api/track/subscriptions", {
        method: subscription ? "PATCH" : "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: subscription?.id, name: values.get("name"), costOre, category: values.get("category"), billingPeriod: values.get("billingPeriod"), nextPaymentDate: values.get("nextPaymentDate"), autoRenew: values.get("autoRenew") === "on", status: values.get("status"), notes: values.get("notes") }),
      }));
      await onSaved(); onClose();
    } catch (submitError) { setError(t(submitError instanceof Error ? submitError.message : "The tracker request failed.")); }
    finally { setSaving(false); }
  }
  return <form className="track-form" onSubmit={submit}>
    <div className="track-form-grid track-form-grid-main"><label className="track-field-wide">{t("Name")}<input name="name" maxLength={160} defaultValue={subscription?.name} placeholder="e.g. Inventory software" required /></label><label>{t("Cost")} <small>per billing period · DKK</small><input name="cost" inputMode="decimal" defaultValue={subscription ? (subscription.costOre / 100).toFixed(2) : ""} placeholder="0,00" required /></label></div>
    <div className="track-form-grid"><label>{t("Category")}<input name="category" list="subscription-category-options" maxLength={80} defaultValue={subscription?.category} placeholder="Choose or type a category" required /><datalist id="subscription-category-options">{subscriptionCategories.map((category) => <option value={category} key={category} />)}</datalist></label><label>{t("Billing period")}<select name="billingPeriod" defaultValue={subscription?.billingPeriod ?? "MONTHLY"}>{billingPeriods.map((period) => <option value={period} key={period}>{billingLabel(period)}</option>)}</select></label><label>{t("Next payment")}<input name="nextPaymentDate" type="date" defaultValue={subscription?.nextPaymentDate ?? localDate()} required /></label><label>{t("Status")}<select name="status" defaultValue={subscription?.status ?? "ACTIVE"}><option value="ACTIVE">{t("Active")}</option><option value="ARCHIVED">{t("Archived")}</option></select></label></div>
    <label className="track-toggle-field" aria-label={t("Auto-renew")}><input name="autoRenew" type="checkbox" defaultChecked={Boolean(subscription?.autoRenew)} /><span><strong>{t("Auto-renew")}</strong><small>Informational only. Payments are never created automatically.</small></span></label>
    <label>{t("Note")}<textarea name="notes" maxLength={2000} defaultValue={subscription?.notes} placeholder={t("Optional context")} /></label>
    {error ? <p className="track-form-error" role="alert">{error}</p> : null}
    <footer className="track-dialog-actions"><button type="button" className="track-button-secondary" onClick={onClose}>{t("Cancel")}</button><button type="submit" className="track-button-primary" disabled={saving}>{t(saving ? "Saving…" : subscription ? "Save subscription" : "Add subscription")}</button></footer>
  </form>;
}

function PaymentForm({ subscriptions, subscription, payment, onClose, onSaved }: { subscriptions: TrackerSubscription[]; subscription?: TrackerSubscription; payment?: TrackerSubscriptionPayment; onClose: () => void; onSaved: () => Promise<void> }) {
  const { t } = useTrackerI18n();
  const selected = subscription ?? subscriptions.find((item) => item.id === payment?.subscriptionId) ?? subscriptions[0];
  const [error, setError] = useState<string | null>(null); const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null); const values = new FormData(event.currentTarget); const amountOre = dkkToOre(values.get("amount"));
    if (amountOre === null) { setError(t("Use whole units and valid DKK amounts with no more than two decimals.")); return; }
    setSaving(true);
    try {
      await responseJson(await fetch("/api/track/subscription-payments", {
        method: payment ? "PATCH" : "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: payment?.id, subscriptionId: values.get("subscriptionId"), amountOre, occurredAt: values.get("occurredAt"), notes: values.get("notes") }),
      }));
      await onSaved(); onClose();
    } catch (submitError) { setError(t(submitError instanceof Error ? submitError.message : "The tracker request failed.")); }
    finally { setSaving(false); }
  }
  return <form className="track-form" onSubmit={submit}>
    <div className="track-form-grid"><label className="track-field-wide">{t("Subscriptions")}<select name="subscriptionId" defaultValue={selected?.id} required>{subscriptions.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label>{t("Amount")} <small>actual payment · DKK</small><input name="amount" inputMode="decimal" defaultValue={payment ? (payment.amountOre / 100).toFixed(2) : selected ? (selected.costOre / 100).toFixed(2) : ""} placeholder="0,00" required /></label><label>{t("Payment date")}<input name="occurredAt" type="date" defaultValue={payment?.occurredAt ?? localDate()} required /></label></div>
    <p className="track-form-note">Only this recorded payment affects Operating Expenses. The subscription’s planned cost never posts automatically.</p>
    <label>{t("Note")}<textarea name="notes" maxLength={2000} defaultValue={payment?.notes} placeholder={t("Optional context")} /></label>
    {error ? <p className="track-form-error" role="alert">{error}</p> : null}
    <footer className="track-dialog-actions"><button type="button" className="track-button-secondary" onClick={onClose}>{t("Cancel")}</button><button type="submit" className="track-button-primary" disabled={saving}>{t(saving ? "Saving…" : payment ? "Save payment" : "Record payment")}</button></footer>
  </form>;
}

export function TrackerExpenses({ data, onRefresh }: { data: ExpensesData; onRefresh: () => Promise<void> }) {
  const { t, money, date } = useTrackerI18n();
  const [dialog, setDialog] = useState<ExpenseDialog>(null); const [error, setError] = useState<string | null>(null);
  async function remove(endpoint: string, id: string) {
    setError(null);
    try { await responseJson(await fetch(endpoint, { method: "DELETE", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) })); setDialog(null); await onRefresh(); }
    catch (deleteError) { setError(t(deleteError instanceof Error ? deleteError.message : "The tracker request failed.")); setDialog(null); }
  }
  return <>
    <header className="track-topbar"><div><p className="track-kicker">{t("Operating ledger")}</p><h1>{t("Expenses")}</h1><p className="track-heading-detail">{t("Actual operating costs, recurring commitments and payment history.")}</p></div><div className="track-header-actions"><button className="track-button-secondary" type="button" onClick={() => setDialog({ kind: "subscription" })}>＋ {t("Subscriptions")}</button><button className="track-button-primary" type="button" onClick={() => setDialog({ kind: "expense" })}>＋ {t("Expenses")}</button></div></header>
    {error ? <p className="track-form-error track-section-error" role="alert">{error}</p> : null}
    <div className="track-expense-summary"><article><span>01</span><small>{t("Operating expenses")}</small><strong>{money(data.totals.operatingExpensesOre)}</strong></article><article><span>02</span><small>{t("Ordinary expenses")}</small><strong>{money(data.totals.ordinaryExpensesOre)}</strong></article><article><span>03</span><small>{t("Subscription payments")}</small><strong>{money(data.totals.subscriptionExpensesOre)}</strong></article><article><span>04</span><small>{t("Active subscriptions")}</small><strong>{data.totals.activeSubscriptions}</strong></article></div>

    <section className="track-table-panel track-expense-section"><div className="track-panel-heading"><div><p className="track-kicker">Actual spend</p><h2>{t("General expenses")}</h2></div><span>{data.expenses.length}</span></div>{data.expenses.length ? <div className="track-table-scroll"><table className="track-data-table track-expense-table"><thead><tr><th>Name</th><th>{t("Category")}</th><th>{t("Date")}</th><th>{t("Note")}</th><th>{t("Amount")}</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{data.expenses.map((expense) => <tr key={expense.id}><td><strong>{expense.name}</strong></td><td><span className="track-category">{expense.category}</span></td><td><strong>{date(expense.occurredAt)}</strong></td><td><small>{expense.notes || "—"}</small></td><td><strong className="negative">−{money(expense.amountOre)}</strong></td><td><div className="track-row-actions"><button type="button" onClick={() => setDialog({ kind: "expense", expense })}>{t("Edit")}</button><button type="button" className="danger" onClick={() => setDialog({ kind: "delete-expense", expense })}>{t("Delete")}</button></div></td></tr>)}</tbody></table></div> : <div className="track-empty-state"><span>00</span><strong>No operating expenses yet</strong><p>Add a cost only when money has actually been spent.</p><button className="track-button-primary" type="button" onClick={() => setDialog({ kind: "expense" })}>＋ {t("Add expense")}</button></div>}</section>

    <section className="track-subscription-section"><div className="track-panel-heading"><div><p className="track-kicker">Recurring commitments</p><h2>{t("Subscriptions")}</h2></div><button className="track-text-button" type="button" onClick={() => setDialog({ kind: "subscription" })}>{t("Add subscription")} →</button></div>{data.subscriptions.length ? <div className="track-subscription-grid">{data.subscriptions.map((subscription) => <article className={subscription.status === "ARCHIVED" ? "archived" : ""} key={subscription.id}><header><div><span className={`track-status ${subscription.status === "ACTIVE" ? "track-status-listed" : "track-status-sold"}`}>{t(subscription.status === "ACTIVE" ? "Active" : "Archived")}</span><h3>{subscription.name}</h3><p>{subscription.category} · {billingLabel(subscription.billingPeriod)}</p></div><strong>{money(subscription.costOre)}</strong></header><dl><div><dt>{t("Next payment")}</dt><dd>{date(subscription.nextPaymentDate)}</dd></div><div><dt>{t("Auto-renew")}</dt><dd>{t(subscription.autoRenew ? "On" : "Off")}</dd></div><div><dt>Payments recorded</dt><dd>{subscription.paymentCount}</dd></div><div><dt>Actual paid</dt><dd>{money(subscription.paidTotalOre)}</dd></div></dl>{subscription.notes ? <p className="track-subscription-note">{subscription.notes}</p> : null}<footer><button type="button" onClick={() => setDialog({ kind: "subscription", subscription })}>{t("Edit")}</button><button type="button" className="danger" onClick={() => setDialog({ kind: "delete-subscription", subscription })}>{t("Delete")}</button><button type="button" className="primary" onClick={() => setDialog({ kind: "payment", subscription })}>{t("Record payment")}</button></footer></article>)}</div> : <div className="track-empty-state"><span>00</span><strong>No subscriptions</strong><p>Track renewal dates without posting costs until a payment is recorded.</p><button className="track-button-secondary" type="button" onClick={() => setDialog({ kind: "subscription" })}>＋ {t("Add subscription")}</button></div>}</section>

    <section className="track-table-panel track-expense-section"><div className="track-panel-heading"><div><p className="track-kicker">Actual recurring spend</p><h2>{t("Subscription payment history")}</h2></div>{data.subscriptions.length ? <button className="track-text-button" type="button" onClick={() => setDialog({ kind: "payment" })}>{t("Record payment")} →</button> : <span>{data.payments.length}</span>}</div>{data.payments.length ? <div className="track-table-scroll"><table className="track-data-table track-expense-table"><thead><tr><th>{t("Subscriptions")}</th><th>{t("Date")}</th><th>{t("Note")}</th><th>{t("Amount")}</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{data.payments.map((payment) => <tr key={payment.id}><td><strong>{payment.subscriptionName}</strong></td><td><strong>{date(payment.occurredAt)}</strong></td><td><small>{payment.notes || "—"}</small></td><td><strong className="negative">−{money(payment.amountOre)}</strong></td><td><div className="track-row-actions"><button type="button" onClick={() => setDialog({ kind: "payment", payment })}>{t("Edit")}</button><button type="button" className="danger" onClick={() => setDialog({ kind: "delete-payment", payment })}>{t("Delete")}</button></div></td></tr>)}</tbody></table></div> : <div className="track-empty-state"><span>00</span><strong>No subscription payments recorded</strong><p>Planned subscription costs do not affect profit until a payment appears here.</p></div>}</section>

    {dialog?.kind === "expense" ? <Modal title={dialog.expense ? "Edit expense" : "Add expense"} kicker="Operating cost" onClose={() => setDialog(null)} wide><ExpenseForm expense={dialog.expense} onClose={() => setDialog(null)} onSaved={onRefresh} /></Modal> : null}
    {dialog?.kind === "subscription" ? <Modal title={dialog.subscription ? "Edit subscription" : "Add subscription"} kicker="Recurring commitment" onClose={() => setDialog(null)} wide><SubscriptionForm subscription={dialog.subscription} onClose={() => setDialog(null)} onSaved={onRefresh} /></Modal> : null}
    {dialog?.kind === "payment" ? <Modal title={dialog.payment ? "Edit subscription payment" : "Record subscription payment"} kicker="Actual operating expense" onClose={() => setDialog(null)} wide><PaymentForm subscriptions={data.subscriptions} subscription={dialog.subscription} payment={dialog.payment} onClose={() => setDialog(null)} onSaved={onRefresh} /></Modal> : null}
    {dialog?.kind === "delete-expense" ? <Modal title="Delete expense?" kicker="Permanent ledger change" onClose={() => setDialog(null)}><div className="track-delete-copy"><p>This removes <strong>{dialog.expense.name}</strong> and changes Operating Expenses and Net Profit. It cannot be undone.</p></div><footer className="track-dialog-actions"><button className="track-button-secondary" type="button" onClick={() => setDialog(null)}>Keep expense</button><button className="track-button-danger" type="button" onClick={() => void remove("/api/track/expenses", dialog.expense.id)}>Delete expense</button></footer></Modal> : null}
    {dialog?.kind === "delete-subscription" ? <Modal title="Delete subscription?" kicker="Permanent ledger change" onClose={() => setDialog(null)}><div className="track-delete-copy"><p><strong>{dialog.subscription.name}</strong><br />Subscriptions with payment history must be archived so the operating ledger remains complete.</p></div><footer className="track-dialog-actions"><button className="track-button-secondary" type="button" onClick={() => setDialog(null)}>{t("Cancel")}</button><button className="track-button-danger" type="button" onClick={() => void remove("/api/track/subscriptions", dialog.subscription.id)}>{t("Delete")}</button></footer></Modal> : null}
    {dialog?.kind === "delete-payment" ? <Modal title="Delete payment?" kicker="Permanent ledger change" onClose={() => setDialog(null)}><div className="track-delete-copy"><p>This removes the recorded payment for <strong>{dialog.payment.subscriptionName}</strong> and recalculates Net Profit. It cannot be undone.</p></div><footer className="track-dialog-actions"><button className="track-button-secondary" type="button" onClick={() => setDialog(null)}>Keep payment</button><button className="track-button-danger" type="button" onClick={() => void remove("/api/track/subscription-payments", dialog.payment.id)}>Delete payment</button></footer></Modal> : null}
  </>;
}
