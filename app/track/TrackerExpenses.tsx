"use client";

import { type FormEvent, useState } from "react";
import { useTrackerI18n } from "./i18n";
import { TrackerModal } from "./TrackerModal";
import {
  billingPeriods, type BillingPeriod, type ExpensesData, type TrackerExpense,
  type TrackerSubscription, type TrackerSubscriptionPayment,
} from "./types";

type ExpenseDialog =
  | { kind: "expense"; expense?: TrackerExpense }
  | { kind: "subscription"; subscription?: TrackerSubscription }
  | { kind: "payment"; subscription?: TrackerSubscription; payment?: TrackerSubscriptionPayment }
  | { kind: "delete-expense"; expense: TrackerExpense }
  | { kind: "delete-subscription"; subscription: TrackerSubscription }
  | { kind: "delete-subscription-payments"; subscription: TrackerSubscription }
  | { kind: "delete-payment"; payment: TrackerSubscriptionPayment }
  | null;

const expenseCategories = ["Software", "Proxies", "Shipping", "Services", "Other"];
const subscriptionCategories = ["Software", "Services", "Banking", "Tools", "Membership", "Other"];
const billingKeys: Record<BillingPeriod, string> = { WEEKLY: "Weekly", MONTHLY: "Monthly", QUARTERLY: "Quarterly", YEARLY: "Yearly", CUSTOM: "Custom" };

function localDate() { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`; }
function subscriptionDueState(subscription: TrackerSubscription) {
  if (subscription.status !== "ACTIVE" || !subscription.autoRenew || !/^\d{4}-\d{2}-\d{2}$/.test(subscription.nextPaymentDate)) return null;
  const today = Date.parse(`${localDate()}T00:00:00Z`); const due = Date.parse(`${subscription.nextPaymentDate}T00:00:00Z`);
  if (Number.isNaN(today) || Number.isNaN(due)) return null;
  const days = Math.round((due - today) / 86_400_000);
  return days < 0 ? { kind: "overdue" as const, days: Math.abs(days) } : days === 0 ? { kind: "today" as const, days: 0 } : null;
}
function dkkToOre(value: FormDataEntryValue | null) {
  const normalized = String(value ?? "").trim().replace(/\s/g, "").replace(",", ".");
  const match = normalized.match(/^(\d{1,10})(?:\.(\d{0,2}))?$/);
  if (!match) return null;
  const ore = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(ore) && ore > 0 && ore <= 100_000_000_000 ? ore : null;
}

async function responseJson<T>(response: Response): Promise<T> {
  const payload = await response.json() as T & { error?: string; errorCode?: string };
  if (!response.ok) throw new Error(payload.errorCode ?? payload.error ?? "TRACKER_REQUEST_FAILED");
  return payload;
}

function CategoryInput({ name, categories, defaultValue }: { name: string; categories: string[]; defaultValue?: string }) {
  const { t } = useTrackerI18n();
  const listId = `${name}-category-options`;
  return <label>{t("Category")}<input name="category" list={listId} maxLength={80} defaultValue={defaultValue} placeholder={t("Choose or type a category")} required /><datalist id={listId}>{categories.map((category) => <option value={category} label={t(category)} key={category} />)}</datalist></label>;
}

function ExpenseForm({ expense, onClose, onSaved }: { expense?: TrackerExpense; onClose: () => void; onSaved: () => Promise<void> }) {
  const { t, decimal, decimalPlaceholder } = useTrackerI18n();
  const [error, setError] = useState<string | null>(null); const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null); const values = new FormData(event.currentTarget); const amountOre = dkkToOre(values.get("amount"));
    if (amountOre === null) { setError(t("Use whole units and valid DKK amounts with no more than two decimals.")); return; }
    setSaving(true);
    try {
      await responseJson(await fetch("/api/track/expenses", { method: expense ? "PATCH" : "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: expense?.id, name: values.get("name"), amountOre, category: values.get("category"), occurredAt: values.get("occurredAt"), notes: values.get("notes") }) }));
      await onSaved(); onClose();
    } catch (submitError) { setError(t(submitError instanceof Error ? submitError.message : "TRACKER_REQUEST_FAILED")); }
    finally { setSaving(false); }
  }
  return <form className="track-form" onSubmit={submit}>
    <div className="track-form-grid track-form-grid-main"><label className="track-field-wide">{t("Name")}<input name="name" maxLength={160} defaultValue={expense?.name} placeholder={t("Name")} required /></label><label>{t("Amount")} <small>DKK</small><input name="amount" inputMode="decimal" defaultValue={expense ? decimal(expense.amountOre) : ""} placeholder={decimalPlaceholder} required /></label></div>
    <div className="track-form-grid"><CategoryInput name="expense" categories={expenseCategories} defaultValue={expense?.category} /><label>{t("Date")}<input name="occurredAt" type="date" defaultValue={expense?.occurredAt ?? localDate()} required /></label></div>
    <label>{t("Note")}<textarea name="notes" maxLength={2000} defaultValue={expense?.notes} placeholder={t("Optional context")} /></label>
    {error ? <p className="track-form-error" role="alert">{error}</p> : null}
    <footer className="track-dialog-actions"><button type="button" className="track-button-secondary" onClick={onClose}>{t("Cancel")}</button><button type="submit" className="track-button-primary" disabled={saving}>{t(saving ? "Saving…" : expense ? "Save expense" : "Add expense")}</button></footer>
  </form>;
}

function SubscriptionForm({ subscription, onClose, onSaved }: { subscription?: TrackerSubscription; onClose: () => void; onSaved: () => Promise<void> }) {
  const { t, decimal, decimalPlaceholder } = useTrackerI18n();
  const [error, setError] = useState<string | null>(null); const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null); const values = new FormData(event.currentTarget); const costOre = dkkToOre(values.get("cost"));
    if (costOre === null) { setError(t("Use whole units and valid DKK amounts with no more than two decimals.")); return; }
    setSaving(true);
    try {
      await responseJson(await fetch("/api/track/subscriptions", { method: subscription ? "PATCH" : "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: subscription?.id, name: values.get("name"), costOre, category: values.get("category"), billingPeriod: values.get("billingPeriod"), nextPaymentDate: values.get("nextPaymentDate"), autoRenew: values.get("autoRenew") === "on", status: values.get("status"), notes: values.get("notes") }) }));
      await onSaved(); onClose();
    } catch (submitError) { setError(t(submitError instanceof Error ? submitError.message : "TRACKER_REQUEST_FAILED")); }
    finally { setSaving(false); }
  }
  return <form className="track-form" onSubmit={submit}>
    <div className="track-form-grid track-form-grid-main"><label className="track-field-wide">{t("Name")}<input name="name" maxLength={160} defaultValue={subscription?.name} placeholder={t("Name")} required /></label><label>{t("Cost")} <small>{t("per billing period · DKK")}</small><input name="cost" inputMode="decimal" defaultValue={subscription ? decimal(subscription.costOre) : ""} placeholder={decimalPlaceholder} required /></label></div>
    <div className="track-form-grid"><CategoryInput name="subscription" categories={subscriptionCategories} defaultValue={subscription?.category} /><label>{t("Billing period")}<select name="billingPeriod" defaultValue={subscription?.billingPeriod ?? "MONTHLY"}>{billingPeriods.map((period) => <option value={period} key={period}>{t(billingKeys[period])}</option>)}</select></label><label>{t("Next payment")}<input name="nextPaymentDate" type="date" defaultValue={subscription?.nextPaymentDate ?? localDate()} required /></label><label>{t("Status")}<select name="status" defaultValue={subscription?.status ?? "ACTIVE"}><option value="ACTIVE">{t("Active")}</option><option value="ARCHIVED">{t("Archived")}</option></select></label></div>
    <label className="track-toggle-field" aria-label={t("Auto-renew")}><input name="autoRenew" type="checkbox" defaultChecked={Boolean(subscription?.autoRenew)} /><span><strong>{t("Auto-renew")}</strong><small>{t("A payment is recorded automatically on each renewal date.")}</small></span></label>
    <label>{t("Note")}<textarea name="notes" maxLength={2000} defaultValue={subscription?.notes} placeholder={t("Optional context")} /></label>
    {error ? <p className="track-form-error" role="alert">{error}</p> : null}
    <footer className="track-dialog-actions"><button type="button" className="track-button-secondary" onClick={onClose}>{t("Cancel")}</button><button type="submit" className="track-button-primary" disabled={saving}>{t(saving ? "Saving…" : subscription ? "Save subscription" : "Add subscription")}</button></footer>
  </form>;
}

function PaymentForm({ subscriptions, subscription, payment, onClose, onSaved }: { subscriptions: TrackerSubscription[]; subscription?: TrackerSubscription; payment?: TrackerSubscriptionPayment; onClose: () => void; onSaved: () => Promise<void> }) {
  const { t, decimal, decimalPlaceholder } = useTrackerI18n();
  const selected = subscription ?? subscriptions.find((item) => item.id === payment?.subscriptionId) ?? subscriptions[0];
  const [error, setError] = useState<string | null>(null); const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null); const values = new FormData(event.currentTarget); const amountOre = dkkToOre(values.get("amount"));
    if (amountOre === null) { setError(t("Use whole units and valid DKK amounts with no more than two decimals.")); return; }
    setSaving(true);
    try {
      await responseJson(await fetch("/api/track/subscription-payments", { method: payment ? "PATCH" : "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: payment?.id, subscriptionId: values.get("subscriptionId"), amountOre, occurredAt: values.get("occurredAt"), notes: values.get("notes") }) }));
      await onSaved(); onClose();
    } catch (submitError) { setError(t(submitError instanceof Error ? submitError.message : "TRACKER_REQUEST_FAILED")); }
    finally { setSaving(false); }
  }
  return <form className="track-form" onSubmit={submit}>
    <div className="track-form-grid"><label className="track-field-wide">{t("Subscriptions")}<select name="subscriptionId" defaultValue={selected?.id} required>{subscriptions.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label>{t("Amount")} <small>{t("actual payment · DKK")}</small><input name="amount" inputMode="decimal" defaultValue={payment ? decimal(payment.amountOre) : selected ? decimal(selected.costOre) : ""} placeholder={decimalPlaceholder} required /></label><label>{t("Payment date")}<input name="occurredAt" type="date" defaultValue={payment?.occurredAt ?? localDate()} required /></label></div>
    <p className="track-form-note">{t("Recorded payments and active auto-renewals affect Operating Expenses. Turn off auto-renew to keep payments manual.")}</p>
    <label>{t("Note")}<textarea name="notes" maxLength={2000} defaultValue={payment?.notes} placeholder={t("Optional context")} /></label>
    {error ? <p className="track-form-error" role="alert">{error}</p> : null}
    <footer className="track-dialog-actions"><button type="button" className="track-button-secondary" onClick={onClose}>{t("Cancel")}</button><button type="submit" className="track-button-primary" disabled={saving}>{t(saving ? "Saving…" : payment ? "Save payment" : "Record payment")}</button></footer>
  </form>;
}

function FinalSubscriptionDelete({ subscription, busy, onBack, onDelete }: { subscription: TrackerSubscription; busy: boolean; onBack: () => void; onDelete: (confirmationName: string) => void }) {
  const { t, money } = useTrackerI18n();
  const [confirmationName, setConfirmationName] = useState("");
  return <><div className="track-destructive-confirm"><span>!</span><p>{t("Delete subscription and payments")}</p><strong>{subscription.name}</strong><dl><div><dt>{t("Recorded payments")}</dt><dd>{subscription.paymentCount}</dd></div><div><dt>{t("Payment total")}</dt><dd>{money(subscription.paidTotalOre)}</dd></div></dl><small>{t("Permanently remove the subscription and its payments. Operating Expenses and Net Profit will be recalculated.")}</small><label>{t("Type {name} to confirm", { name: subscription.name })}<input value={confirmationName} onChange={(event) => setConfirmationName(event.target.value)} autoComplete="off" aria-label={t("Subscription name")} /></label></div><footer className="track-dialog-actions"><button className="track-button-secondary" type="button" onClick={onBack}>{t("Back")}</button><button className="track-button-danger" type="button" disabled={busy || confirmationName !== subscription.name} onClick={() => onDelete(confirmationName)}>{t("Permanently delete everything")}</button></footer></>;
}

export function TrackerExpenses({ data, onRefresh }: { data: ExpensesData; onRefresh: () => Promise<void> }) {
  const { t, money, date } = useTrackerI18n();
  const [dialog, setDialog] = useState<ExpenseDialog>(null); const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  async function remove(endpoint: string, body: Record<string, unknown>) {
    setError(null); setBusy(true);
    try { await responseJson(await fetch(endpoint, { method: "DELETE", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })); setDialog(null); await onRefresh(); }
    catch (deleteError) { setError(t(deleteError instanceof Error ? deleteError.message : "TRACKER_REQUEST_FAILED")); setDialog(null); }
    finally { setBusy(false); }
  }
  return <>
    <header className="track-topbar"><div><p className="track-kicker">{t("Operating ledger")}</p><h1>{t("Expenses")}</h1><p className="track-heading-detail">{t("Actual operating costs, recurring commitments and payment history.")}</p></div><div className="track-header-actions"><button className="track-button-secondary" type="button" onClick={() => setDialog({ kind: "subscription" })}>＋ {t("Subscriptions")}</button><button className="track-button-primary" type="button" onClick={() => setDialog({ kind: "expense" })}>＋ {t("Expenses")}</button></div></header>
    {error ? <p className="track-form-error track-section-error" role="alert">{error}</p> : null}
    <div className="track-expense-summary"><article><span>01</span><small>{t("Operating expenses")}</small><strong>{money(data.totals.operatingExpensesOre)}</strong></article><article><span>02</span><small>{t("Ordinary expenses")}</small><strong>{money(data.totals.ordinaryExpensesOre)}</strong></article><article><span>03</span><small>{t("Subscription payments")}</small><strong>{money(data.totals.subscriptionExpensesOre)}</strong></article><article><span>04</span><small>{t("Active subscriptions")}</small><strong>{data.totals.activeSubscriptions}</strong></article></div>

    <section className="track-table-panel track-expense-section"><div className="track-panel-heading"><div><p className="track-kicker">{t("Actual spend")}</p><h2>{t("General expenses")}</h2></div><span>{data.expenses.length}</span></div>{data.expenses.length ? <div className="track-table-scroll"><table className="track-data-table track-expense-table"><thead><tr><th>{t("Name")}</th><th>{t("Category")}</th><th>{t("Date")}</th><th>{t("Note")}</th><th>{t("Amount")}</th><th><span className="sr-only">{t("Actions")}</span></th></tr></thead><tbody>{data.expenses.map((expense) => <tr key={expense.id}><td><strong>{expense.name}</strong>{expense.sourceType === "SUBSCRIPTION_PAYMENT" ? <small className="track-source-label">{t("Former subscription payment")}</small> : null}</td><td><span className="track-category">{t(expense.category)}</span></td><td><strong>{date(expense.occurredAt)}</strong></td><td><small>{expense.notes || "—"}</small></td><td><strong className="negative">−{money(expense.amountOre)}</strong></td><td><div className="track-row-actions"><button type="button" onClick={() => setDialog({ kind: "expense", expense })}>{t("Edit")}</button><button type="button" className="danger" onClick={() => setDialog({ kind: "delete-expense", expense })}>{t("Delete")}</button></div></td></tr>)}</tbody></table></div> : <div className="track-empty-state"><span>00</span><strong>{t("No operating expenses yet")}</strong><p>{t("Add a cost only when money has actually been spent.")}</p><button className="track-button-primary" type="button" onClick={() => setDialog({ kind: "expense" })}>＋ {t("Add expense")}</button></div>}</section>

    <section className="track-subscription-section"><div className="track-panel-heading"><div><p className="track-kicker">{t("Recurring commitments")}</p><h2>{t("Subscriptions")}</h2></div><button className="track-text-button" type="button" onClick={() => setDialog({ kind: "subscription" })}>{t("Add subscription")} →</button></div>{data.subscriptions.length ? <div className="track-subscription-grid">{data.subscriptions.map((subscription) => { const due = subscriptionDueState(subscription); return <article className={subscription.status === "ARCHIVED" ? "archived" : ""} key={subscription.id}><header><div><span className={`track-status ${subscription.status === "ACTIVE" ? "track-status-listed" : "track-status-sold"}`}>{t(subscription.status === "ACTIVE" ? "Active" : "Archived")}</span><h3>{subscription.name}</h3><p>{t(subscription.category)} · {t(billingKeys[subscription.billingPeriod])}</p></div><strong>{money(subscription.costOre)}</strong></header><dl><div><dt>{t("Next payment")}</dt><dd>{date(subscription.nextPaymentDate)}{due ? <small className={`track-subscription-due ${due.kind}`}>{t(due.kind === "overdue" ? "Overdue by {count} days" : "Due today", { count: due.days })}</small> : null}</dd></div><div><dt>{t("Auto-renew")}</dt><dd>{t(subscription.autoRenew ? "On" : "Off")}</dd></div><div><dt>{t("Payments recorded")}</dt><dd>{subscription.paymentCount}</dd></div><div><dt>{t("Actual paid")}</dt><dd>{money(subscription.paidTotalOre)}</dd></div></dl>{subscription.notes ? <p className="track-subscription-note">{subscription.notes}</p> : null}<footer><button type="button" onClick={() => setDialog({ kind: "subscription", subscription })}>{t("Edit")}</button><button type="button" className="danger" onClick={() => setDialog({ kind: "delete-subscription", subscription })}>{t("Delete")}</button><button type="button" className="primary" onClick={() => setDialog({ kind: "payment", subscription })}>{t("Record payment")}</button></footer></article>; })}</div> : <div className="track-empty-state"><span>00</span><strong>{t("No subscriptions")}</strong><p>{t("Set a renewal date and enable auto-renew to record the recurring cost automatically.")}</p><button className="track-button-secondary" type="button" onClick={() => setDialog({ kind: "subscription" })}>＋ {t("Add subscription")}</button></div>}</section>

    <section className="track-table-panel track-expense-section"><div className="track-panel-heading"><div><p className="track-kicker">{t("Actual recurring spend")}</p><h2>{t("Subscription payment history")}</h2></div>{data.subscriptions.length ? <button className="track-text-button" type="button" onClick={() => setDialog({ kind: "payment" })}>{t("Record payment")} →</button> : <span>{data.payments.length}</span>}</div>{data.payments.length ? <div className="track-table-scroll"><table className="track-data-table track-expense-table"><thead><tr><th>{t("Subscriptions")}</th><th>{t("Date")}</th><th>{t("Note")}</th><th>{t("Amount")}</th><th><span className="sr-only">{t("Actions")}</span></th></tr></thead><tbody>{data.payments.map((payment) => <tr key={payment.id}><td><strong>{payment.subscriptionName}</strong></td><td><strong>{date(payment.occurredAt)}</strong></td><td><small>{payment.notes || "—"}</small></td><td><strong className="negative">−{money(payment.amountOre)}</strong></td><td><div className="track-row-actions"><button type="button" onClick={() => setDialog({ kind: "payment", payment })}>{t("Edit")}</button><button type="button" className="danger" onClick={() => setDialog({ kind: "delete-payment", payment })}>{t("Delete")}</button></div></td></tr>)}</tbody></table></div> : <div className="track-empty-state"><span>00</span><strong>{t("No subscription payments recorded")}</strong><p>{t("Planned subscription costs do not affect profit until a payment appears here.")}</p></div>}</section>

    {dialog?.kind === "expense" ? <TrackerModal title={t(dialog.expense ? "Edit expense" : "Add expense")} kicker={t("Operating cost")} closeLabel={t("Close dialog")} onClose={() => setDialog(null)} wide><ExpenseForm expense={dialog.expense} onClose={() => setDialog(null)} onSaved={onRefresh} /></TrackerModal> : null}
    {dialog?.kind === "subscription" ? <TrackerModal title={t(dialog.subscription ? "Edit subscription" : "Add subscription")} kicker={t("Recurring commitment")} closeLabel={t("Close dialog")} onClose={() => setDialog(null)} wide><SubscriptionForm subscription={dialog.subscription} onClose={() => setDialog(null)} onSaved={onRefresh} /></TrackerModal> : null}
    {dialog?.kind === "payment" ? <TrackerModal title={t(dialog.payment ? "Edit subscription payment" : "Record subscription payment")} kicker={t("Actual operating expense")} closeLabel={t("Close dialog")} onClose={() => setDialog(null)} wide><PaymentForm subscriptions={data.subscriptions} subscription={dialog.subscription} payment={dialog.payment} onClose={() => setDialog(null)} onSaved={onRefresh} /></TrackerModal> : null}
    {dialog?.kind === "delete-expense" ? <TrackerModal title={t("Delete expense?")} kicker={t("Permanent ledger change")} closeLabel={t("Close dialog")} onClose={() => setDialog(null)}><div className="track-delete-copy"><p>{t("This removes {name} and changes Operating Expenses and Net Profit. It cannot be undone.", { name: dialog.expense.name })}</p></div><footer className="track-dialog-actions"><button className="track-button-secondary" type="button" onClick={() => setDialog(null)}>{t("Keep expense")}</button><button className="track-button-danger" type="button" disabled={busy} onClick={() => void remove("/api/track/expenses", { id: dialog.expense.id })}>{t("Delete expense")}</button></footer></TrackerModal> : null}
    {dialog?.kind === "delete-subscription" ? <TrackerModal title={t("Delete subscription?")} kicker={t("Subscription options")} closeLabel={t("Close dialog")} onClose={() => setDialog(null)}><div className="track-subscription-delete"><header><strong>{dialog.subscription.name}</strong><p>{t("Choose how to preserve the operating ledger.")}</p><dl><div><dt>{t("Recorded payments")}</dt><dd>{dialog.subscription.paymentCount}</dd></div><div><dt>{t("Payment total")}</dt><dd>{money(dialog.subscription.paidTotalOre)}</dd></div></dl>{dialog.subscription.paymentCount ? <small>{t("Deleting can change Operating Expenses and Net Profit.")}</small> : null}</header><button type="button" onClick={() => void remove("/api/track/subscriptions", { id: dialog.subscription.id, mode: "ARCHIVE" })}><span>A</span><div><strong>{t("Archive subscription")}</strong><small>{t("Keep the subscription and every payment. Historical financial figures do not change.")}</small></div></button><button type="button" onClick={() => void remove("/api/track/subscriptions", { id: dialog.subscription.id, mode: "KEEP_PAYMENTS" })}><span>B</span><div><strong>{t("Delete subscription, keep payments")}</strong><small>{t("Move every historical payment to standalone operating expenses. Name, amount, date, notes and source details are preserved.")}</small></div></button><button className="destructive" type="button" onClick={() => setDialog({ kind: "delete-subscription-payments", subscription: dialog.subscription })}><span>C</span><div><strong>{t("Delete subscription and payments")}</strong><small>{t("Permanently remove the subscription and its payments. Operating Expenses and Net Profit will be recalculated.")}</small></div></button></div><footer className="track-dialog-actions"><button className="track-button-secondary" type="button" onClick={() => setDialog(null)}>{t("Cancel")}</button></footer></TrackerModal> : null}
    {dialog?.kind === "delete-subscription-payments" ? <TrackerModal title={t("Final destructive confirmation")} kicker={t("This action cannot be undone")} closeLabel={t("Close dialog")} onClose={() => setDialog(null)}><FinalSubscriptionDelete subscription={dialog.subscription} busy={busy} onBack={() => setDialog({ kind: "delete-subscription", subscription: dialog.subscription })} onDelete={(confirmationName) => void remove("/api/track/subscriptions", { id: dialog.subscription.id, mode: "DELETE_WITH_PAYMENTS", confirmationName })} /></TrackerModal> : null}
    {dialog?.kind === "delete-payment" ? <TrackerModal title={t("Delete payment?")} kicker={t("Permanent ledger change")} closeLabel={t("Close dialog")} onClose={() => setDialog(null)}><div className="track-delete-copy"><p>{t("This removes the recorded payment for {name} and recalculates Net Profit. It cannot be undone.", { name: dialog.payment.subscriptionName })}</p></div><footer className="track-dialog-actions"><button className="track-button-secondary" type="button" onClick={() => setDialog(null)}>{t("Keep payment")}</button><button className="track-button-danger" type="button" disabled={busy} onClick={() => void remove("/api/track/subscription-payments", { id: dialog.payment.id })}>{t("Delete payment")}</button></footer></TrackerModal> : null}
  </>;
}
