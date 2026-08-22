export const emailImportStatuses = ["RECEIVED", "PROCESSING", "NEEDS_REVIEW", "READY", "IMPORTED", "DUPLICATE", "REJECTED", "FAILED"] as const;
export type EmailImportStatus = (typeof emailImportStatuses)[number];
export type Provenance = "DOCUMENTED" | "DERIVED" | "UNKNOWN";
export type EmailMoney = { minor: number; currency: string; raw: string; source: string | null; provenance: Provenance };
export type ParsedEmailItem = { name: string | null; quantity: number | null; unitAmount: EmailMoney | null; source: string; provenance: Provenance; sku?: string | null; lineTotal?: EmailMoney | null };
export type EmailAttachment = { name: string; contentType: string; size: number | null; sha256?: string | null; text?: string; extractionStatus?: "EXTRACTED" | "NO_TEXT" | "UNSUPPORTED" | "TOO_LARGE" | "INVALID_PDF" | "FAILED"; issue?: string | null; pages?: number | null; extractedChars?: number | null };
export type ForwardedMessage = { name: string | null; email: string | null; subject: string | null; body: string; marker: number };
export type ParsedEmailDocument = { name: string; kind: "INVOICE" | "RECEIPT" | "EMAIL" | "OTHER"; source: string; extractionStatus: string; textAvailable: boolean; pages?: number | null; extractedChars?: number | null };
export type ParsedPurchaseEmail = {
  parser: string; supplier: string | null; supplierSource: string | null; originalSenderName: string | null; originalSenderEmail: string | null; originalSubject: string | null;
  forwardedChain: Array<Pick<ForwardedMessage, "name" | "email" | "subject">>; orderNumber: string | null; orderNumberSource: string | null; receiptNumber: string | null; receiptNumberSource: string | null; invoiceNumber: string | null; invoiceNumberSource: string | null; purchaseDate: string | null; purchaseDateSource: string | null;
  currency: string | null; subtotal: EmailMoney | null; shipping: EmailMoney | null; discount: EmailMoney | null; total: EmailMoney | null; amountPaid: EmailMoney | null;
  vatAmount: EmailMoney | null; vatRateBps: number | null; items: ParsedEmailItem[]; documents: ParsedEmailDocument[]; issues: string[]; conflicts: string[]; textPreview: string;
};
export type EmailPurchaseReview = { supplier: string; purchaseDate: string; fxRate: string; orderNumber?: string; receiptNumber?: string; invoiceNumber?: string; currency?: string; documentTotals?: Record<string, string>; items: Array<{
  sourceItemId?: string | null; name: string; quantity: number; unitPriceOre: number | null; shippingOre: number | null; supplierCountry: string;
  priceMode: string; vatTreatment: string; vatRateBps: number | null; inputVatOre: number | null; outputVatOre: number | null; deductibleVatOre: number | null;
}> };

const supportedCurrencies = new Set(["DKK", "EUR", "USD", "GBP", "SEK", "NOK"]);
const clean = (value: string, max = 2_000) => value.replace(/\u00a0/g, " ").replace(/[\t ]+/g, " ").trim().slice(0, max);
export function htmlToText(value: string) { return clean(value.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, " ").replace(/<\/?(?:p|div|br|tr|li|h[1-6])\b[^>]*>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&"), 120_000); }

export function parseMoney(raw: string): EmailMoney | null {
  const match = clean(raw, 100).match(/(?:\b(DKK|EUR|USD|GBP|SEK|NOK)\b\s*|([€£]))?([+-]?[\d.\s,]+)(?:\s*\b(DKK|EUR|USD|GBP|SEK|NOK)\b|\s*([€£]))?/i);
  if (!match) return null;
  const symbolCurrency = (symbol: string | undefined) => symbol === "€" ? "EUR" : symbol === "£" ? "GBP" : "";
  const currencies = [...new Set([match[1]?.toUpperCase(), symbolCurrency(match[2]), match[4]?.toUpperCase(), symbolCurrency(match[5])].filter(Boolean))];
  if (currencies.length !== 1 || !supportedCurrencies.has(currencies[0])) return null;
  const currency = currencies[0]; const numberText = match[3].replace(/\s/g, ""); const decimalAt = Math.max(numberText.lastIndexOf(","), numberText.lastIndexOf("."));
  const decimal = decimalAt >= 0 && numberText.length - decimalAt - 1 <= 2 ? numberText.slice(decimalAt + 1) : "";
  const whole = (decimalAt >= 0 ? numberText.slice(0, decimalAt) : numberText).replace(/[.,]/g, "");
  if (!/^\d+$/.test(whole) || !/^\d{0,2}$/.test(decimal)) return null;
  const minor = Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
  return Number.isSafeInteger(minor) && minor >= 0 ? { minor, currency, raw: clean(raw, 100), source: null, provenance: "UNKNOWN" } : null;
}

type Mailbox = { name: string | null; email: string | null };
type Candidate = { source: string; kind: "INVOICE" | "RECEIPT" | "EMAIL" | "OTHER"; priority: number; supplier: string | null; supplierSource: string | null; orderNumber: string | null; receiptNumber: string | null; invoiceNumber: string | null; purchaseDate: string | null; subtotal: EmailMoney | null; shipping: EmailMoney | null; discount: EmailMoney | null; total: EmailMoney | null; amountPaid: EmailMoney | null; vatAmount: EmailMoney | null; vatRateBps: number | null; items: ParsedEmailItem[] };

function mailbox(value: string | null | undefined): Mailbox {
  const raw = clean(value ?? "", 320); const match = raw.match(/^(.*?)\s*<([^>\s]+@[^>\s]+)>\s*$/);
  if (match) return { name: clean(match[1].replace(/^['"]|['"]$/g, ""), 160) || null, email: match[2].trim().toLowerCase() };
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) ? { name: null, email: raw.toLowerCase() } : { name: raw || null, email: null };
}

export function extractForwardedMessages(text: string): ForwardedMessage[] {
  const lines = text.replace(/\r/g, "").split("\n"); const markers = lines.map((line, index) => /(?:forwarded message|videresendt (?:mail|besked)|begin forwarded message)/i.test(line) ? index : -1).filter((index) => index >= 0);
  return markers.flatMap((marker, markerIndex) => {
    const limit = markers[markerIndex + 1] ?? lines.length; const headerLines = lines.slice(marker + 1, Math.min(limit, marker + 25));
    const fromLine = headerLines.find((line) => /^\s*(?:from|fra)\s*:/i.test(line)); const subjectLine = headerLines.find((line) => /^\s*(?:subject|emne)\s*:/i.test(line));
    const blank = headerLines.findIndex((line, index) => index > 0 && !line.trim()); const from = mailbox(fromLine?.replace(/^\s*(?:from|fra)\s*:\s*/i, "")); const subject = clean(subjectLine?.replace(/^\s*(?:subject|emne)\s*:\s*/i, "") ?? "", 500) || null;
    const bodyStart = marker + 1 + (blank >= 0 ? blank + 1 : headerLines.length); const body = lines.slice(bodyStart, limit).join("\n");
    return from.email || from.name || subject ? [{ ...from, subject, body, marker }] : [];
  });
}
export function extractForwardedMessage(text: string) { const messages = extractForwardedMessages(text); return messages.at(-1) ?? null; }

function documentKind(name: string, email = false): Candidate["kind"] { if (email) return "EMAIL"; if (/invoice|faktura/i.test(name)) return "INVOICE"; if (/receipt|kvittering/i.test(name)) return "RECEIPT"; return "OTHER"; }
function priority(kind: Candidate["kind"]) { return kind === "INVOICE" ? 40 : kind === "RECEIPT" ? 30 : kind === "EMAIL" ? 20 : 10; }
function sourceMoney(raw: string, source: string) { const value = parseMoney(raw); return value ? { ...value, source, provenance: "DOCUMENTED" as const } : null; }
function escaped(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function moneyAfter(text: string, labels: string[], source: string) {
  const lines = text.split(/\r?\n/).map((value) => clean(value, 500));
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]; const label = labels.find((value) => new RegExp(`^${escaped(value)}(?:\\b|\\s|:|$)`, "i").test(line)); if (!label) continue;
    const remainder = line.slice(label.length).trim(); const direct = sourceMoney(line, source);
    const remainderMoney = sourceMoney(remainder.replace(/^[:-–—]\s*/, ""), source); if (remainderMoney) return remainderMoney;
    if (direct && (remainder === "" || /^[€£]|^(?:DKK|EUR|USD|GBP|SEK|NOK)\b|^\d/.test(remainder))) return direct;
    if (remainder === "" || /^[–—:-]/.test(remainder)) {
      const next = lines[index + 1] ?? ""; const nextMoney = sourceMoney(next, source); if (nextMoney) return nextMoney;
    }
  }
  return null;
}
function reference(text: string, labels: string[]) { const matches = [...new Set([...text.matchAll(new RegExp(`(?:${labels.join("|")})(?:\\s*(?:number|nummer|nr\\.?|no\\.?))?\\s*[:#]?\\s*([A-Z0-9][A-Z0-9\\-/]{2,})`, "gi"))].map((match) => match[1]))]; return matches.length === 1 ? matches[0] : null; }
function subjectReference(subject: string, labels: string[]) { const match = subject.match(new RegExp(`(?:${labels.join("|")})[^#\\n]{0,140}#\\s*([A-Z0-9][A-Z0-9\\-/]{2,})`, "i")); return match?.[1] ?? null; }
function dateFromParts(raw: string) {
  const numeric = raw.match(/^(\d{4}-\d{2}-\d{2}|\d{1,2}[./-]\d{1,2}[./-]\d{4})$/); if (!numeric) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const [day, month, year] = raw.split(/[./-]/).map(Number); const output = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`; const date = new Date(`${output}T00:00:00Z`); return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === output ? output : null;
}
function documentedDate(text: string) {
  const match = text.match(/(?:order date|purchase date|invoice date|ordredato|købsdato|fakturadato|dato)\s*:?\s*(\d{4}-\d{2}-\d{2}|\d{1,2}[./-]\d{1,2}[./-]\d{4})/i);
  if (match) return dateFromParts(match[1]);
  const paid = text.match(/\bpaid\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})\b/i); const value = paid ? new Date(`${paid[1]} UTC`) : null;
  return value && !Number.isNaN(value.getTime()) ? value.toISOString().slice(0, 10) : null;
}
function itemsFromText(text: string, source: string) {
  const items: ParsedEmailItem[] = [];
  for (const line of text.split(/\r?\n/).map((value) => clean(value, 500)).filter(Boolean)) {
    const match = line.match(/^(\d{1,6})\s*(?:x|×)\s+(.+?)\s+((?:(?:DKK|EUR|USD|GBP|SEK|NOK)\s*)?[\d.\s,]+(?:\s*(?:DKK|EUR|USD|GBP|SEK|NOK))?)$/i);
    if (!match) continue; const amount = sourceMoney(match[3], source); const name = clean(match[2], 160); if (name && amount) items.push({ name, quantity: Number(match[1]), unitAmount: amount, source, provenance: "DOCUMENTED" });
  }
  return items;
}
function supplierFromText(text: string) {
  const line = text.split(/\r?\n/).find((value) => /^\s*(?:supplier|vendor|seller|leverandør)\s*:/i.test(value)); if (line) return clean(line.replace(/^\s*(?:supplier|vendor|seller|leverandør)\s*:\s*/i, ""), 160) || null;
  const receipt = text.match(/^\s*receipt from\s+(.+?)\s*$/im); return receipt ? clean(receipt[1], 160) || null : null;
}
function stripeReceiptItems(text: string, source: string, supplier: string | null) {
  const lines = text.split(/\r?\n/).map((value) => clean(value, 500)); const qty = lines.findIndex((line) => /^qty\s+\d+$/i.test(line)); if (qty < 0 || !supplier) return [];
  const quantity = Number(lines[qty].match(/\d+/)?.[0] ?? 0); const amount = sourceMoney(lines.slice(qty + 1, qty + 4).find((line) => Boolean(sourceMoney(line, source))) ?? "", source); const productName = lines.slice(0, qty).reverse().find((line) => Boolean(line) && !/^receipt(?:\s|#|$)|^payment method/i.test(line)) ?? supplier;
  return quantity > 0 && amount ? [{ name: productName, quantity, unitAmount: null, lineTotal: amount, source, provenance: "DOCUMENTED" as const }] : [];
}
function candidateFromText(text: string, source: string, kind: Candidate["kind"], subject = "", supplier: string | null = null, supplierSource: string | null = null): Candidate {
  const invoiceNumber = subjectReference(subject, ["invoice", "faktura"]) ?? reference(`${subject}\n${text}`, ["invoice", "faktura"]); const receiptNumber = subjectReference(subject, ["receipt", "kvittering"]) ?? reference(`${subject}\n${text}`, ["receipt", "kvittering"]); const orderNumber = subjectReference(subject, ["order", "ordre"]) ?? reference(`${subject}\n${text}`, ["order", "ordre"]);
  const vatLine = text.split(/\r?\n/).find((value) => /^\s*(?:vat|moms)\b/i.test(value)); const rate = vatLine?.match(/\(?\s*(\d{1,2}(?:[.,]\d{1,2})?)\s*%\s*(?:incl\.)?\)?/i); const parsedSupplier = supplier ?? supplierFromText(text); const parsedItems = itemsFromText(text, source);
  return { source, kind, priority: priority(kind), supplier: parsedSupplier, supplierSource: parsedSupplier ? (supplierSource ?? (source.includes("receipt") ? "stripe_receipt_label" : `${source}_supplier`)) : null, receiptNumber, invoiceNumber, orderNumber, purchaseDate: documentedDate(text), subtotal: moneyAfter(text, ["subtotal", "delsum", "net total", "total excluding tax"], source), shipping: moneyAfter(text, ["shipping", "delivery", "fragt"], source), discount: moneyAfter(text, ["discount", "rabat"], source), total: moneyAfter(text, ["amount paid", "grand total", "total paid", "total", "i alt"], source), amountPaid: moneyAfter(text, ["amount paid"], source), vatAmount: moneyAfter(text, ["vat", "moms"], source), vatRateBps: rate ? Math.round(Number(rate[1].replace(",", ".")) * 100) : null, items: parsedItems.length ? parsedItems : stripeReceiptItems(text, source, parsedSupplier) };
}
function sameValue(value: unknown) { return value && typeof value === "object" && "minor" in value && "currency" in value ? `${(value as EmailMoney).minor}:${(value as EmailMoney).currency}` : JSON.stringify(value); }
function choose<T>(candidates: Candidate[], field: keyof Candidate, conflict: string) { const values = candidates.map((candidate) => ({ candidate, value: candidate[field] as T | null })).filter((entry) => entry.value !== null && entry.value !== undefined); const unique = [...new Set(values.map((entry) => sameValue(entry.value)))]; if (unique.length > 1) return { value: null as T | null, conflict, source: null }; const winner = values.sort((a, b) => b.candidate.priority - a.candidate.priority)[0]; return { value: winner?.value ?? null, conflict: null, source: winner?.candidate.source ?? null }; }
function sameItems(left: ParsedEmailItem[], right: ParsedEmailItem[]) { return sameValue(left.map((item) => [item.name?.toLowerCase(), item.quantity, item.unitAmount?.minor, item.unitAmount?.currency])) === sameValue(right.map((item) => [item.name?.toLowerCase(), item.quantity, item.unitAmount?.minor, item.unitAmount?.currency])); }

export function parsePurchaseEmail(input: { from: string; subject: string; textBody: string; htmlBody?: string | null; originalSender?: string | null; originalSubject?: string | null; attachments?: EmailAttachment[] }) : ParsedPurchaseEmail {
  const outerText = clean(input.textBody || htmlToText(input.htmlBody ?? ""), 120_000); const forwardedChain = extractForwardedMessages(outerText); const forwarded = forwardedChain.at(-1) ?? null; const suppliedSender = mailbox(input.originalSender);
  const original = forwarded ? { name: forwarded.name, email: forwarded.email } : suppliedSender.email || suppliedSender.name ? suppliedSender : mailbox(input.from);
  const originalSubject = clean(forwarded?.subject ?? input.originalSubject ?? input.subject, 500) || null; const primaryText = clean(forwarded?.body || outerText, 120_000); const emailSource = forwarded ? "nested_forwarded_email_body" : "email_body"; const fallbackSupplier = original.name || (original.email?.split("@")[1] ?? null);
  const candidates = [candidateFromText(primaryText, emailSource, "EMAIL", originalSubject ?? "", fallbackSupplier, forwarded ? "nested_forwarded_email_header" : original.name ? "email_from_header" : "email_from_domain")]; const documents: ParsedEmailDocument[] = [{ name: forwarded ? "Original forwarded email" : "Email body", kind: "EMAIL", source: emailSource, extractionStatus: "EXTRACTED", textAvailable: Boolean(primaryText), extractedChars: primaryText.length }];
  for (const attachment of input.attachments ?? []) { const kind = documentKind(attachment.name); const source = `attachment:${attachment.name}`; const text = clean(attachment.text ?? "", 40_000); documents.push({ name: attachment.name, kind, source, extractionStatus: attachment.extractionStatus ?? "UNSUPPORTED", textAvailable: Boolean(text), pages: attachment.pages ?? null, extractedChars: attachment.extractedChars ?? text.length }); if (attachment.extractionStatus === "EXTRACTED" && text) candidates.push(candidateFromText(text, source, kind)); }
  const conflicts: string[] = []; const picked = <T>(field: keyof Candidate, conflict: string) => { const result = choose<T>(candidates, field, conflict); if (result.conflict) conflicts.push(result.conflict); return result; };
  const supplier = picked<string>("supplier", "CONFLICTING_SUPPLIER"); const orderNumber = picked<string>("orderNumber", "CONFLICTING_ORDER_NUMBER"); const receiptNumber = picked<string>("receiptNumber", "CONFLICTING_RECEIPT_NUMBER"); const invoiceNumber = picked<string>("invoiceNumber", "CONFLICTING_INVOICE_NUMBER"); const purchaseDate = picked<string>("purchaseDate", "CONFLICTING_PURCHASE_DATE"); const subtotal = picked<EmailMoney>("subtotal", "CONFLICTING_SUBTOTAL"); const shipping = picked<EmailMoney>("shipping", "CONFLICTING_SHIPPING"); const discount = picked<EmailMoney>("discount", "CONFLICTING_DISCOUNT"); const total = picked<EmailMoney>("total", "CONFLICTING_TOTAL"); const amountPaid = picked<EmailMoney>("amountPaid", "CONFLICTING_AMOUNT_PAID"); const vatAmount = picked<EmailMoney>("vatAmount", "CONFLICTING_VAT_AMOUNT"); const vatRate = picked<number>("vatRateBps", "CONFLICTING_VAT_RATE");
  const itemCandidates = candidates.filter((candidate) => candidate.items.length).sort((a, b) => b.priority - a.priority); const items = itemCandidates[0]?.items ?? []; if (itemCandidates.slice(1).some((candidate) => !sameItems(items, candidate.items))) conflicts.push("CONFLICTING_LINE_ITEMS"); const currencies = [...new Set([subtotal.value, shipping.value, discount.value, total.value, vatAmount.value, ...items.map((item) => item.unitAmount)].filter(Boolean).map((value) => (value as EmailMoney).currency))]; const currency = currencies.length === 1 ? currencies[0] : null;
  const issues: string[] = []; if (!items.length) issues.push("NO_LINE_ITEMS"); if (!total.value) issues.push("MISSING_TOTAL"); if (!currency) issues.push("CURRENCY_UNKNOWN"); if (currencies.length > 1) issues.push("MULTIPLE_CURRENCIES"); if (vatAmount.value && !vatRate.value) issues.push("VAT_INCOMPLETE"); if ((input.attachments ?? []).some((attachment) => attachment.contentType === "application/pdf" && attachment.extractionStatus !== "EXTRACTED")) issues.push("PDF_TEXT_UNAVAILABLE");
  return { parser: "generic-layered-v3", supplier: supplier.value, supplierSource: supplier.source ?? null, originalSenderName: original.name, originalSenderEmail: original.email, originalSubject, forwardedChain: forwardedChain.map(({ name, email, subject }) => ({ name, email, subject })), orderNumber: orderNumber.value, orderNumberSource: orderNumber.source ?? null, receiptNumber: receiptNumber.value, receiptNumberSource: receiptNumber.source ?? null, invoiceNumber: invoiceNumber.value, invoiceNumberSource: invoiceNumber.source ?? null, purchaseDate: purchaseDate.value, purchaseDateSource: purchaseDate.source ?? null, currency, subtotal: subtotal.value, shipping: shipping.value, discount: discount.value, total: total.value, amountPaid: amountPaid.value, vatAmount: vatAmount.value, vatRateBps: vatRate.value, items, documents, issues, conflicts, textPreview: primaryText.slice(0, 20_000) };
}

export function initialEmailPurchaseReview(parsed: ParsedPurchaseEmail): EmailPurchaseReview {
  const oneItem = parsed.items.length === 1;
  return { supplier: parsed.supplier ?? "", purchaseDate: parsed.purchaseDate ?? "", fxRate: "", orderNumber: parsed.orderNumber ?? "", receiptNumber: parsed.receiptNumber ?? "", invoiceNumber: parsed.invoiceNumber ?? "", currency: parsed.currency ?? "", documentTotals: { subtotal: parsed.subtotal ? `${parsed.subtotal.minor / 100}` : "", shipping: parsed.shipping ? `${parsed.shipping.minor / 100}` : "", discount: parsed.discount ? `${parsed.discount.minor / 100}` : "", vat: parsed.vatAmount ? `${parsed.vatAmount.minor / 100}` : "", total: parsed.total ? `${parsed.total.minor / 100}` : "", amountPaid: parsed.amountPaid ? `${parsed.amountPaid.minor / 100}` : "" }, items: parsed.items.map((item) => ({ name: item.name ?? "", quantity: item.quantity ?? 0, unitPriceOre: parsed.currency === "DKK" ? item.unitAmount?.minor ?? null : null, shippingOre: oneItem && parsed.currency === "DKK" ? parsed.shipping?.minor ?? 0 : null, supplierCountry: "", priceMode: "", vatTreatment: "", vatRateBps: null, inputVatOre: null, outputVatOre: null, deductibleVatOre: null })) };
}
