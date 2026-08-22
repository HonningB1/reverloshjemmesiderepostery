import PostalMime from "postal-mime";
import { extractPdfText, MAX_PDF_BYTES } from "./pdf.js";

interface Env {
  REVERLO_EMAIL_INGEST_URL: string;
  REVERLO_EMAIL_INGEST_SECRET: string;
  CF_ACCESS_CLIENT_ID?: string;
  CF_ACCESS_CLIENT_SECRET?: string;
}
type IncomingEmailMessage = {
  rawSize: number; raw: ReadableStream; from: string; to: string; headers: Headers;
  setReject(reason: string): void;
};
type EmailWorkerHandler = { email(message: IncomingEmailMessage, env: Env): Promise<void> };

const MAX_RAW_BYTES = 5_000_000;
const MAX_BODY_CHARS = 120_000;
const MAX_ATTACHMENTS = 24;
const MAX_TOTAL_PDF_BYTES = 4_000_000;

function limited(value: string | null | undefined) { return (value ?? "").slice(0, MAX_BODY_CHARS); }
function htmlText(value: string) { return value.replace(/<\/?(?:p|div|br|tr|li)\b[^>]*>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " "); }
function firstAddress(value: unknown) {
  const first = Array.isArray(value) ? value[0] : value;
  return first && typeof first === "object" && typeof (first as { address?: unknown }).address === "string" ? (first as { address: string }).address.slice(0, 320) : "";
}
function forwardedMessage(text: string) {
  const lines = text.replace(/\r/g, "").split("\n"); const marker = lines.findIndex((line) => /(?:forwarded message|videresendt (?:mail|besked)|begin forwarded message)/i.test(line));
  if (marker < 0) return null;
  const headers = lines.slice(marker, marker + 24); const from = headers.find((line) => /^\s*(?:from|fra)\s*:/i.test(line))?.replace(/^\s*(?:from|fra)\s*:\s*/i, "").trim(); const subject = headers.find((line) => /^\s*(?:subject|emne)\s*:/i.test(line))?.replace(/^\s*(?:subject|emne)\s*:\s*/i, "").trim();
  return from || subject ? { from: from?.slice(0, 320) ?? "", subject: subject?.slice(0, 500) ?? "" } : null;
}

export default {
  async email(message, env): Promise<void> {
    if (message.rawSize > MAX_RAW_BYTES) { message.setReject("Purchase email is too large to process."); return; }
    const parsed = await PostalMime.parse(message.raw);
    const textBody = limited(parsed.text); const htmlBody = limited(parsed.html); const forwarded = forwardedMessage(textBody || htmlText(htmlBody));
    const originalSender = forwarded?.from || firstAddress(parsed.from) || message.from; let totalPdfBytes = 0;
    const attachments = [] as Array<{ name: string; contentType: string; size: number | null; sha256?: string; text?: string; extractionStatus?: string; issue?: string | null; pages?: number | null }>;
    for (const attachment of (parsed.attachments ?? []).slice(0, MAX_ATTACHMENTS)) {
      const name = String(attachment.filename ?? "").slice(0, 240); const contentType = String(attachment.mimeType ?? "").toLowerCase().slice(0, 120); const content = attachment.content instanceof Uint8Array ? attachment.content : attachment.content instanceof ArrayBuffer ? new Uint8Array(attachment.content) : null; const size = content?.byteLength ?? null;
      if (contentType !== "application/pdf" || !content) { attachments.push({ name, contentType, size, extractionStatus: "UNSUPPORTED", issue: contentType === "application/pdf" ? "PDF_BINARY_UNAVAILABLE" : null }); continue; }
      totalPdfBytes += content.byteLength;
      if (totalPdfBytes > MAX_TOTAL_PDF_BYTES || content.byteLength > MAX_PDF_BYTES) { attachments.push({ name, contentType, size, extractionStatus: "TOO_LARGE", issue: totalPdfBytes > MAX_TOTAL_PDF_BYTES ? "PDF_TOTAL_TOO_LARGE" : "PDF_TOO_LARGE" }); continue; }
      const extraction = await extractPdfText(content); attachments.push({ name, contentType, size, ...extraction });
    }
    const headers = new Headers({ "content-type": "application/json", "x-reverlo-email-ingest-secret": env.REVERLO_EMAIL_INGEST_SECRET });
    if (env.CF_ACCESS_CLIENT_ID && env.CF_ACCESS_CLIENT_SECRET) {
      headers.set("CF-Access-Client-Id", env.CF_ACCESS_CLIENT_ID); headers.set("CF-Access-Client-Secret", env.CF_ACCESS_CLIENT_SECRET);
    }
    const response = await fetch(env.REVERLO_EMAIL_INGEST_URL, { method: "POST", headers, body: JSON.stringify({
      from: originalSender, originalSender, originalSubject: forwarded?.subject ?? parsed.subject ?? message.headers.get("subject") ?? "", forwardedBy: message.from, to: message.to, subject: parsed.subject ?? message.headers.get("subject") ?? "",
      messageId: message.headers.get("message-id") ?? "", emailDate: message.headers.get("date") ?? "", textBody, htmlBody, attachments,
    }) });
    if (!response.ok && response.status !== 409) throw new Error(`Purchase ingestion failed with ${response.status}.`);
  },
} satisfies EmailWorkerHandler;
