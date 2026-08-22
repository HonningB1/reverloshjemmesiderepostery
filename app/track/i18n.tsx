"use client";

import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { trackerDa, trackerEn, type TrackerTranslationKey } from "./translations";

export type TrackerLocale = "en" | "da";

function interpolate(value: string, values?: Record<string, string | number>) {
  return values ? value.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? `{${key}}`)) : value;
}

export function translate(locale: TrackerLocale, key: TrackerTranslationKey | string, values?: Record<string, string | number>) {
  const dictionary: Record<string, string> = locale === "da" ? trackerDa : trackerEn;
  return interpolate(dictionary[key] ?? key, values);
}

type ContextValue = {
  locale: TrackerLocale;
  setLocale: (locale: TrackerLocale) => void;
  t: (key: TrackerTranslationKey | string, values?: Record<string, string | number>) => string;
  money: (ore: number, compact?: boolean) => string;
  date: (value: string) => string;
  percent: (numerator: number, denominator: number) => string;
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
    const numberLocale = locale === "da" ? "da-DK" : "en-GB";
    const fullMoney = new Intl.NumberFormat(numberLocale, { style: "currency", currency: "DKK", minimumFractionDigits: 2 });
    const compactMoney = new Intl.NumberFormat(numberLocale, { style: "currency", currency: "DKK", notation: "compact", maximumFractionDigits: 1 });
    const dates = new Intl.DateTimeFormat(numberLocale, { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
    const percentages = new Intl.NumberFormat(numberLocale, { maximumFractionDigits: 1, minimumFractionDigits: 1 });
    return {
      locale, setLocale, t: (key, values) => translate(locale, key, values),
      money: (ore, compact = false) => (compact && Math.abs(ore) >= 10_000_000 ? compactMoney : fullMoney).format(ore / 100),
      date: (raw) => { const parsed = new Date(`${raw}T00:00:00Z`); return Number.isNaN(parsed.getTime()) ? raw : dates.format(parsed); },
      percent: (numerator, denominator) => denominator ? `${percentages.format((numerator / denominator) * 100)}%` : "—",
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
