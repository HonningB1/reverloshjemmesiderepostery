import { env } from "cloudflare:workers";
import { emailImportId, emailImportItemId, noStoreJson, strictTrackerText, trackerDb, trackerError, trackerUnavailable } from "../../../../lib/tracker";
import { initialEmailPurchaseReview, parsePurchaseEmail } from "../../../../lib/tracker-email-parser";

const MAX_REQUEST_BYTES = 260_000;
const MAX_BODY_CHARS = 120_000;
const MAX_ATTACHMENTS = 24;

function sameSecret(received: string | null, expected: string | undefined) {
  if (!received || !expected) return false;
  const a = new TextEncoder().encode(received); const b = new TextEncoder().encode(expected);
  const length = Math.max(a.length, b.length); let difference = a.length ^ b.length;
  for (let index = 0; index < length; index += 1) difference |= (a[index % a.length] ?? 0) ^ (b[index % b.length] ?? 0);
  return difference === 0;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function string(value: unknown, length: number) { return strictTrackerText(value, length); }
function attachments(value: unknown) {
  if (!Array.isArray(value) || value.length > MAX_ATTACHMENTS) return null;
  const result = [] as Array<{ name: string; contentType: string; size: number | null }>;
  for (const item of value) {
    if (!item || typeof item !== "object") return null; const row = item as Record<string, unknown>;
    const name = string(row.name ?? "", 240); const contentType = string(row.contentType ?? "", 120);
    const size = typeof row.size === "number" && Number.isSafeInteger(row.size) && row.size >= 0 && row.size <= 25_000_000 ? row.size : null;
    if (name === null || contentType === null) return null; result.push({ name, contentType, size });
  }
  return result;
}

export async function POST(request: Request) {
  const db = trackerDb(); if (!db) return trackerUnavailable();
  if (!sameSecret(request.headers.get("x-reverlo-email-ingest-secret"), env.REVERLO_EMAIL_INGEST_SECRET)) {
    return noStoreJson({ error: "Unauthorized email ingestion request.", errorCode: "EMAIL_INGEST_UNAUTHORIZED" }, { status: 401 });
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_REQUEST_BYTES) return noStoreJson({ error: "Email payload is too large.", errorCode: "EMAIL_INGEST_TOO_LARGE" }, { status: 413 });
  try {
    const raw = await request.text();
    if (raw.length > MAX_REQUEST_BYTES) return noStoreJson({ error: "Email payload is too large.", errorCode: "EMAIL_INGEST_TOO_LARGE" }, { status: 413 });
    const payload = JSON.parse(raw) as Record<string, unknown>;
    const from = string(payload.from, 320); const to = string(payload.to, 320); const subject = string(payload.subject ?? "", 500);
    const messageId = string(payload.messageId ?? "", 500); const forwardedBy = string(payload.forwardedBy ?? "", 320);
    const textBody = string(payload.textBody ?? "", MAX_BODY_CHARS); const htmlBody = string(payload.htmlBody ?? "", MAX_BODY_CHARS);
    const emailDate = string(payload.emailDate ?? "", 100); const fileMetadata = attachments(payload.attachments ?? []);
    if (!from || !to || subject === null || messageId === null || forwardedBy === null || textBody === null || htmlBody === null || emailDate === null || !fileMetadata) {
      return noStoreJson({ error: "Email payload is malformed.", errorCode: "EMAIL_INGEST_INVALID" }, { status: 400 });
    }
    const parsed = parsePurchaseEmail({ from, subject, textBody, htmlBody });
    const storedTextBody = textBody || parsed.textPreview;
    const normalizedSupplier = (parsed.supplier ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    const orderKey = parsed.orderNumber && normalizedSupplier ? `${normalizedSupplier}:${parsed.orderNumber.toLowerCase()}` : null;
    const fingerprint = await sha256([messageId.toLowerCase(), from.toLowerCase(), subject.toLowerCase(), textBody, htmlBody].join("\n"));
    const duplicate = await db.prepare(`SELECT id, status FROM tracker_email_imports WHERE source_fingerprint = ? OR
      (? != '' AND message_id = ?) OR (? IS NOT NULL AND order_key = ?) LIMIT 1`).bind(fingerprint, messageId, messageId, orderKey, orderKey).first<{ id: string; status: string }>();
    if (duplicate) return noStoreJson({ status: "DUPLICATE", duplicateOf: duplicate.id, existingStatus: duplicate.status });
    const id = emailImportId(); const review = initialEmailPurchaseReview(parsed);
    await db.batch([
      db.prepare(`INSERT INTO tracker_email_imports
        (id, status, source_fingerprint, message_id, order_key, original_sender, forwarded_by, recipient, subject, email_date, text_body, html_body, attachments_json, parsed_json, review_json, error_code)
        VALUES (?, 'NEEDS_REVIEW', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, fingerprint, messageId || null, orderKey, from, forwardedBy, to, subject, emailDate || null, storedTextBody, "", JSON.stringify(fileMetadata), JSON.stringify(parsed), JSON.stringify(review), parsed.issues[0] ?? null),
      ...parsed.items.map((item, position) => db.prepare(`INSERT INTO tracker_email_import_items (id, email_import_id, position, parsed_json) VALUES (?, ?, ?, ?)`)
        .bind(emailImportItemId(), id, position, JSON.stringify(item))),
    ]);
    return noStoreJson({ id, status: "NEEDS_REVIEW" }, { status: 202 });
  } catch (error) {
    return trackerError(error, "Unable to receive the purchase email.", "EMAIL_INGEST_FAILED");
  }
}
