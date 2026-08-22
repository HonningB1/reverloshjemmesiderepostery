export const emailImportStatuses = ["RECEIVED", "PROCESSING", "NEEDS_REVIEW", "READY", "IMPORTED", "DUPLICATE", "REJECTED", "FAILED"] as const;
export type EmailImportStatus = (typeof emailImportStatuses)[number];
export type Provenance = "DOCUMENTED" | "DERIVED" | "UNKNOWN";
export type EmailMoney = { minor: number; currency: string; raw: string; source: string | null; provenance: Provenance };
export type ParsedEmailItem = { name: string | null; quantity: number | null; unitAmount: EmailMoney | null; source: string; provenance: Provenance };
export type ParsedPurchaseEmail = {
  parser: string; supplier: string | null; supplierSource: string | null; orderNumber: string | null; purchaseDate: string | null;
  currency: string | null; subtotal: EmailMoney | null; shipping: EmailMoney | null; discount: EmailMoney | null; total: EmailMoney | null;
  vatAmount: EmailMoney | null; vatRateBps: number | null; items: ParsedEmailItem[]; issues: string[]; textPreview: string;
};
export type EmailPurchaseReview = { supplier: string; purchaseDate: string; fxRate: string; items: Array<{
  name: string; quantity: number; unitPriceOre: number | null; shippingOre: number | null; supplierCountry: string;
  priceMode: string; vatTreatment: string; vatRateBps: number | null; inputVatOre: number | null; outputVatOre: number | null; deductibleVatOre: number | null;
}> };

const supportedCurrencies = new Set(["DKK", "EUR", "USD", "GBP", "SEK", "NOK"]);
const clean = (value: string, max = 2_000) => value.replace(/\u00a0/g, " ").replace(/[\t ]+/g, " ").trim().slice(0, max);
export function htmlToText(value: string) { return clean(value.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, " ").replace(/<\/?(?:p|div|br|tr|li|h[1-6])\b[^>]*>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&"), 120_000); }

export function parseMoney(raw: string): EmailMoney | null {
  const match = clean(raw, 80).match(/(?:\b(DKK|EUR|USD|GBP|SEK|NOK)\b\s*)?([+-]?[\d.\s,]+)(?:\s*\b(DKK|EUR|USD|GBP|SEK|NOK)\b)?/i);
  if (!match) return null;
  const currency = (match[1] ?? match[3] ?? "").toUpperCase(); if (!supportedCurrencies.has(currency)) return null;
  const numberText = match[2].replace(/\s/g, ""); const lastComma = numberText.lastIndexOf(","); const lastDot = numberText.lastIndexOf(".");
  const decimalAt = Math.max(lastComma, lastDot); const decimal = decimalAt >= 0 && numberText.length - decimalAt - 1 <= 2 ? numberText.slice(decimalAt + 1) : "";
  const whole = (decimalAt >= 0 ? numberText.slice(0, decimalAt) : numberText).replace(/[.,]/g, "");
  if (!/^\d+$/.test(whole) || !/^\d{0,2}$/.test(decimal)) return null;
  const minor = Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
  return Number.isSafeInteger(minor) && minor >= 0 ? { minor, currency, raw: clean(raw, 80), source: null, provenance: "UNKNOWN" } : null;
}

function moneyAfter(text: string, labels: string[]) {
  const line = text.split(/\r?\n/).find((value) => new RegExp(`^\\s*(?:${labels.join("|")})\\b`, "i").test(value));
  const amount = line ? parseMoney(line) : null;
  return amount ? { ...amount, source: `email_summary_${labels[0]}`, provenance: "DOCUMENTED" as const } : null;
}
function orderNumber(text: string) {
  const matches = [...new Set([...text.matchAll(/(?:order\s*(?:number|nr\.?)|ordre\s*(?:nummer|nr\.?)|invoice\s*(?:number|no\.?)|faktura\s*(?:nummer|nr\.?))\s*:?\s*([A-Z0-9][A-Z0-9\-/]{2,})|(?:order|ordre|invoice|faktura)\s*#\s*([A-Z0-9][A-Z0-9\-/]{2,})/gi)]
    .map((match) => match[1] ?? match[2])
    .filter(Boolean))];
  return matches.length === 1 ? matches[0] : null;
}
function documentedDate(text: string) {
  const match = text.match(/(?:order date|purchase date|ordredato|købsdato|dato)\s*:?\s*(\d{4}-\d{2}-\d{2}|\d{1,2}[./-]\d{1,2}[./-]\d{4})/i);
  if (!match) return null; const raw = match[1];
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const [day, month, year] = raw.split(/[./-]/).map(Number); const output = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const date = new Date(`${output}T00:00:00Z`); return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === output ? output : null;
}
function itemsFromText(text: string) {
  const items: ParsedEmailItem[] = [];
  for (const line of text.split(/\r?\n/).map((value) => clean(value, 500)).filter(Boolean)) {
    const match = line.match(/^(\d{1,6})\s*(?:x|×)\s+(.+?)\s+((?:(?:DKK|EUR|USD|GBP|SEK|NOK)\s*)?[\d.\s,]+(?:\s*(?:DKK|EUR|USD|GBP|SEK|NOK))?)$/i);
    if (!match) continue;
    const amount = parseMoney(match[3]); const name = clean(match[2], 160);
    if (name && amount) items.push({ name, quantity: Number(match[1]), unitAmount: { ...amount, source: "email_line_item", provenance: "DOCUMENTED" }, source: "email_line_item", provenance: "DOCUMENTED" });
  }
  return items;
}

export function parsePurchaseEmail(input: { from: string; subject: string; textBody: string; htmlBody?: string | null }) : ParsedPurchaseEmail {
  const text = clean(input.textBody || htmlToText(input.htmlBody ?? ""), 120_000); const items = itemsFromText(text);
  const subtotal = moneyAfter(text, ["subtotal", "delsum"]); const shipping = moneyAfter(text, ["shipping", "delivery", "fragt"]);
  const discount = moneyAfter(text, ["discount", "rabat"]); const total = moneyAfter(text, ["total", "grand total", "total paid", "i alt"]);
  const vatAmount = moneyAfter(text, ["vat", "moms"]);
  const vatLine = text.split(/\r?\n/).find((value) => /^\s*(?:vat|moms)\b/i.test(value));
  const vatRate = vatLine?.match(/\(?\s*(\d{1,2}(?:[.,]\d{1,2})?)\s*%\s*\)?/);
  const candidates = [subtotal, shipping, discount, total, vatAmount, ...items.map((item) => item.unitAmount)].filter(Boolean) as EmailMoney[];
  const currencies = [...new Set(candidates.map((value) => value.currency))]; const currency = currencies.length === 1 ? currencies[0] : null;
  const senderDomain = input.from.match(/@([a-z0-9.-]+)$/i)?.[1]?.toLowerCase() ?? null;
  const issues: string[] = []; if (!items.length) issues.push("NO_LINE_ITEMS"); if (!total) issues.push("MISSING_TOTAL"); if (!currency) issues.push("CURRENCY_UNKNOWN");
  if (currencies.length > 1) issues.push("MULTIPLE_CURRENCIES"); if (vatAmount && !vatRate) issues.push("VAT_INCOMPLETE");
  return { parser: "generic-v1", supplier: senderDomain, supplierSource: senderDomain ? "email_from_domain" : null, orderNumber: orderNumber(`${input.subject}\n${text}`),
    purchaseDate: documentedDate(text), currency, subtotal, shipping, discount, total, vatAmount, vatRateBps: vatRate ? Math.round(Number(vatRate[1].replace(",", ".")) * 100) : null,
    items, issues, textPreview: text.slice(0, 20_000) };
}

export function initialEmailPurchaseReview(parsed: ParsedPurchaseEmail): EmailPurchaseReview {
  const oneItem = parsed.items.length === 1;
  return { supplier: parsed.supplier ?? "", purchaseDate: parsed.purchaseDate ?? "", fxRate: "", items: parsed.items.map((item) => ({
    name: item.name ?? "", quantity: item.quantity ?? 0, unitPriceOre: parsed.currency === "DKK" ? item.unitAmount?.minor ?? null : null,
    shippingOre: oneItem && parsed.currency === "DKK" ? parsed.shipping?.minor ?? 0 : null, supplierCountry: "", priceMode: "", vatTreatment: "", vatRateBps: null,
    inputVatOre: null, outputVatOre: null, deductibleVatOre: null,
  })) };
}
