"use client";

import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";

export type TrackerLocale = "en" | "da";

const da: Record<string, string> = {
  "Overview": "Overblik", "Inventory": "Lager", "Transactions": "Transaktioner", "Expenses": "Udgifter",
  "VAT": "Moms", "Analytics": "Analyse", "Calculator": "Beregner", "Private workspace": "Privat arbejdsområde",
  "Reverlo internal": "Reverlo internt", "DKK workspace": "DKK-arbejdsområde", "English": "English", "Danish": "Dansk",
  "Language": "Sprog", "Loading private tracker": "Indlæser privat tracker", "Close dialog": "Luk dialog",
  "Cancel": "Annuller", "Close": "Luk", "Save": "Gem", "Saving…": "Gemmer…", "Edit": "Redigér", "Delete": "Slet",
  "Retry": "Prøv igen", "Refreshing ledger…": "Opdaterer ledger…", "Private · DKK ledger": "Privat · DKK-ledger",
  "All": "Alle", "Purchases": "Køb", "Sales": "Salg", "Purchase": "Køb", "Sale": "Salg",
  "Record purchase": "Registrér køb", "Record sale": "Registrér salg", "Add item": "Tilføj vare",
  "Product name": "Produktnavn", "Inventory item": "Lagervare", "Quantity": "Antal", "Units": "Enheder",
  "Price": "Pris", "Purchase price": "Indkøbspris", "Sale price": "Salgspris", "per unit · DKK": "pr. enhed · DKK",
  "Shipping": "Fragt", "total · DKK": "i alt · DKK", "Supplier": "Leverandør", "Platform": "Platform",
  "Purchase date": "Købsdato", "Sale date": "Salgsdato", "Date": "Dato", "Notes": "Noter", "Note": "Note",
  "Marketplace fees": "Markedspladsgebyrer", "Promoted listing fee": "Promoted listing-gebyr", "Other costs": "Andre omkostninger",
  "Revenue": "Omsætning", "Cost basis": "Kostpris", "Total costs": "Samlede omkostninger", "Net profit": "Nettoresultat",
  "Trading profit": "Handelsresultat", "Operating expenses": "Driftsudgifter", "Margin": "Margin", "ROI": "ROI",
  "Cash out": "Udbetaling", "No transactions in this view": "Ingen transaktioner i denne visning",
  "Record a purchase to add stock, or a sale to realise profit.": "Registrér et køb for at tilføje lager eller et salg for at realisere resultat.",
  "Unified ledger": "Samlet ledger", "Purchases fund inventory. Sales release profit and reduce stock automatically.": "Køb finansierer lageret. Salg realiserer resultat og reducerer automatisk beholdningen.",
  "Filter transactions": "Filtrér transaktioner", "available": "tilgængelige", "No sellable inventory": "Intet salgbart lager",
  "Add a purchase or inventory item before recording a sale.": "Tilføj et køb eller en lagervare, før du registrerer et salg.",
  "Advanced VAT details": "Avancerede momsoplysninger", "Hide VAT details": "Skjul momsoplysninger",
  "Choose VAT treatment": "Vælg momsbehandling",
  "VAT treatment": "Momsbehandling", "Price basis": "Prisgrundlag", "VAT exclusive": "Ekskl. moms", "VAT inclusive": "Inkl. moms",
  "VAT rate": "Momssats", "Input VAT": "Indgående moms", "Output VAT": "Udgående moms",
  "Deductible VAT": "Fradragsberettiget moms", "Supplier country": "Leverandørland", "Customer country": "Kundeland",
  "Business customer (B2B)": "Erhvervskunde (B2B)", "VAT ID reference": "Momsnummer-reference",
  "Danish purchase · deductible VAT": "Dansk køb · fradragsberettiget moms",
  "Danish sale · VAT": "Dansk salg · moms", "EU B2B sale · 0% / reverse charge": "EU B2B-salg · 0 % / omvendt betalingspligt",
  "EU purchase · reverse charge": "EU-køb · omvendt betalingspligt",
  "Private purchase · no deduction": "Privatkøb · intet fradrag", "No VAT / outside scope": "Ingen moms / uden for anvendelsesområde",
  "Custom / manual": "Brugerdefineret / manuel", "VAT unknown": "Moms ukendt", "B2B": "B2B", "EU 0% VAT": "EU 0 % moms",
  "Transaction note": "Transaktionsnote", "Optional context": "Valgfri kontekst", "Recording…": "Registrerer…",
  "Update transaction": "Opdatér transaktion", "Delete transaction?": "Slet transaktion?", "Permanent ledger change": "Permanent ledgerændring",
  "Keep transaction": "Behold transaktion", "Delete transaction": "Slet transaktion",
  "This recalculates inventory, cost basis, profit, ROI and VAT. It cannot be undone.": "Dette genberegner lager, kostpris, resultat, ROI og moms. Det kan ikke fortrydes.",
  "Use whole units and valid DKK amounts with no more than two decimals.": "Brug hele enheder og gyldige DKK-beløb med højst to decimaler.",
  "Check the quantity and DKK amounts before saving.": "Kontrollér antal og DKK-beløb før du gemmer.",
  "EU B2B reverse charge requires a customer country and VAT ID reference.": "EU B2B med omvendt betalingspligt kræver kundeland og momsnummer-reference.",
  "The tracker request failed.": "Tracker-forespørgslen mislykkedes.", "Unable to load the private tracker.": "Den private tracker kunne ikke indlæses.",
  "VAT position": "Momsposition", "VAT ledger": "Momsledger", "Input and output VAT, deductions and actual settlements.": "Indgående og udgående moms, fradrag og faktiske afregninger.",
  "Record settlement": "Registrér afregning", "Input VAT recorded": "Registreret indgående moms",
  "Deductible input VAT": "Fradragsberettiget indgående moms", "Output VAT due": "Skyldig udgående moms",
  "VAT receivable": "Moms til gode", "VAT payable": "Moms til betaling", "Open position": "Åben position",
  "Settlements": "Afregninger", "Paid": "Betalt", "Received": "Modtaget", "Direction": "Retning", "Amount": "Beløb",
  "Reference": "Reference", "Settlement date": "Afregningsdato", "No VAT settlements": "Ingen momsafregninger",
  "Record only money actually paid to or received from the tax authority.": "Registrér kun beløb, der faktisk er betalt til eller modtaget fra skattemyndigheden.",
  "VAT settlements reduce the open VAT position and never affect profit.": "Momsafregninger reducerer den åbne momsposition og påvirker aldrig resultatet.",
  "Edit VAT settlement": "Redigér momsafregning", "Delete VAT settlement?": "Slet momsafregning?",
  "Keep settlement": "Behold afregning", "Delete settlement": "Slet afregning", "Save settlement": "Gem afregning",
  "Loading tracker": "Indlæser tracker", "Preparing the DKK ledger and inventory position.": "Klargør DKK-ledger og lagerposition.",
  "Command centre": "Kommandocentral", "Stock ledger": "Lagerledger", "Operating ledger": "Driftsledger",
  "Performance layer": "Resultatlag", "Decision tool": "Beslutningsværktøj", "Profit Calculator": "Profitberegner",
  "Status": "Status", "Product": "Produkt", "Stock": "Lager", "Target": "Mål", "Potential": "Potentiale",
  "Search product or supplier": "Søg produkt eller leverandør", "No supplier": "Ingen leverandør", "remaining": "resterende",
  "General expenses": "Almindelige udgifter", "Subscriptions": "Abonnementer", "Subscription payment history": "Betalingshistorik for abonnementer",
  "Add expense": "Tilføj udgift", "Add subscription": "Tilføj abonnement", "Record payment": "Registrér betaling",
  "Ordinary expenses": "Almindelige udgifter", "Subscription payments": "Abonnementsbetalinger", "Active subscriptions": "Aktive abonnementer",
  "Category": "Kategori", "Billing period": "Faktureringsperiode", "Next payment": "Næste betaling", "Auto-renew": "Automatisk fornyelse",
  "Active": "Aktiv", "Archived": "Arkiveret", "On": "Til", "Off": "Fra", "Payment date": "Betalingsdato",
  "Name": "Navn", "Cost": "Pris",
  "Trading performance, actual operating spend and capital still in stock.": "Handelsresultat, faktiske driftsudgifter og kapital, der stadig er bundet i lager.",
  "Trading profit − operating expenses": "Handelsresultat − driftsudgifter", "Sales after trading costs": "Salg efter handelsomkostninger",
  "Expenses + recorded subscriptions": "Udgifter + registrerede abonnementsbetalinger", "Gross product sales": "Salgsomsætning ekskl. udgående moms",
  "Inventory value": "Lagerværdi", "Remaining landed cost": "Resterende kostpris inkl. fragt", "Cash invested": "Investeret likviditet",
  "Lifetime purchase outlay": "Samlede køb gennem tiden", "Open expenses →": "Åbn udgifter →", "Review actual business spend": "Gennemgå faktiske virksomhedsudgifter",
  "Bottom line": "Bundlinje", "Net profit over time": "Nettoresultat over tid", "Cumulative net profit after operating expenses": "Akkumuleret nettoresultat efter driftsudgifter",
  "No realised result yet": "Intet realiseret resultat endnu", "Sales and actual operating expenses build the chart.": "Salg og faktiske driftsudgifter opbygger grafen.",
  "Record a sale →": "Registrér et salg →", "Ledger": "Ledger", "Recent activity": "Seneste aktivitet", "View trading →": "Se handel →",
  "No activity yet": "Ingen aktivitet endnu", "Trading and operating entries will form your private ledger.": "Handels- og driftsposter danner din private ledger.",
  "Stock position": "Lagerposition", "Inventory snapshot": "Lagerøjeblik", "Open inventory →": "Åbn lager →", "Inventory is empty": "Lageret er tomt",
  "Add your first product or record a purchase to begin.": "Tilføj dit første produkt eller registrér et køb for at begynde.", "Add inventory →": "Tilføj lager →",
  "Every batch, unit and expected return in one controlled view.": "Hvert parti, hver enhed og forventet afkast i én kontrolleret visning.",
  "Actual recorded spend": "Faktisk registreret forbrug", "Trading performance and real operating spend, without forecasted subscription costs.": "Handelsresultat og reelle driftsudgifter uden forventede abonnementsomkostninger.",
  "No financial activity in this period": "Ingen økonomisk aktivitet i perioden", "Choose another period or record a sale or expense.": "Vælg en anden periode eller registrér et salg eller en udgift.",
  "Economic bridge": "Økonomisk bro", "Revenue and costs": "Omsætning og omkostninger", "Trading costs": "Handelsomkostninger",
  "Product performance": "Produktresultater", "What is actually working": "Det, der faktisk virker", "Units sold": "Solgte enheder", "Profit": "Resultat",
  "No product performance yet": "Ingen produktresultater endnu", "Sales will build a simple product ranking here.": "Salg opbygger en enkel produktrangering her.",
  "Actual operating costs, recurring commitments and payment history.": "Faktiske driftsudgifter, løbende forpligtelser og betalingshistorik.",
  "Expected sale price": "Forventet salgspris", "In stock": "På lager", "Listed": "Annonceret", "Reserved": "Reserveret", "Sold": "Solgt",
  "Test a deal before it enters inventory. Nothing here is saved.": "Test en handel, før den kommer på lager. Intet her gemmes.",
  "The purchase or VAT details contain invalid values.": "Købet eller momsoplysningerne indeholder ugyldige værdier.",
  "The sale or VAT details contain invalid values.": "Salget eller momsoplysningerne indeholder ugyldige værdier.",
  "The purchase update or VAT details contain invalid values.": "Købsopdateringen eller momsoplysningerne indeholder ugyldige værdier.",
  "The sale update or VAT details contain invalid values.": "Salgsopdateringen eller momsoplysningerne indeholder ugyldige værdier.",
  "The selected inventory item no longer exists.": "Den valgte lagervare findes ikke længere.",
  "Delete the related sales before deleting this purchase.": "Slet de relaterede salg, før du sletter dette køb.",
  "Quantity cannot be lower than the units already sold.": "Antallet kan ikke være lavere end de allerede solgte enheder.",
  "This transaction no longer exists.": "Transaktionen findes ikke længere.",
  "Complete the VAT settlement with a direction, amount and date.": "Udfyld momsafregningen med retning, beløb og dato.",
  "This VAT settlement no longer exists.": "Momsafregningen findes ikke længere.",
  "Subscriptions with payment history cannot be deleted. Archive it to preserve the expense ledger.": "Abonnementer med betalingshistorik kan ikke slettes. Arkivér abonnementet for at bevare udgiftsledgeren.",
};

function interpolate(value: string, values?: Record<string, string | number>) {
  return values ? value.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? `{${key}}`)) : value;
}

const en: Record<string, string> = { "Gross product sales": "Sales revenue excluding output VAT" };

export function translate(locale: TrackerLocale, key: string, values?: Record<string, string | number>) {
  return interpolate(locale === "da" ? da[key] ?? key : en[key] ?? key, values);
}

type ContextValue = {
  locale: TrackerLocale;
  setLocale: (locale: TrackerLocale) => void;
  t: (key: string, values?: Record<string, string | number>) => string;
  money: (ore: number, compact?: boolean) => string;
  date: (value: string) => string;
};

const TrackerI18nContext = createContext<ContextValue | null>(null);

export function TrackerI18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<TrackerLocale>("en");
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const stored = window.localStorage.getItem("reverlo-tracker-locale");
      if (stored === "da" || stored === "en") setLocaleState(stored);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  function setLocale(next: TrackerLocale) {
    setLocaleState(next);
    window.localStorage.setItem("reverlo-tracker-locale", next);
  }
  const value = useMemo<ContextValue>(() => {
    const numberLocale = locale === "da" ? "da-DK" : "en-DK";
    const fullMoney = new Intl.NumberFormat(numberLocale, { style: "currency", currency: "DKK", minimumFractionDigits: 2 });
    const compactMoney = new Intl.NumberFormat(numberLocale, { style: "currency", currency: "DKK", notation: "compact", maximumFractionDigits: 1 });
    const dates = new Intl.DateTimeFormat(locale === "da" ? "da-DK" : "en-GB", { day: "2-digit", month: "short", year: "numeric" });
    return {
      locale, setLocale, t: (key, values) => translate(locale, key, values),
      money: (ore, compact = false) => (compact && Math.abs(ore) >= 10_000_000 ? compactMoney : fullMoney).format(ore / 100),
      date: (raw) => { const parsed = new Date(`${raw}T00:00:00Z`); return Number.isNaN(parsed.getTime()) ? raw : dates.format(parsed); },
    };
  }, [locale]);
  return <TrackerI18nContext.Provider value={value}>{children}</TrackerI18nContext.Provider>;
}

export function useTrackerI18n() {
  const value = useContext(TrackerI18nContext);
  if (!value) throw new Error("TrackerI18nProvider is missing.");
  return value;
}

export function TrackerLanguageSelector() {
  const { locale, setLocale, t } = useTrackerI18n();
  return <label className="track-language"><span>{t("Language")}</span><select value={locale} onChange={(event) => setLocale(event.target.value as TrackerLocale)} aria-label={t("Language")}><option value="en">{t("English")}</option><option value="da">{t("Danish")}</option></select></label>;
}
