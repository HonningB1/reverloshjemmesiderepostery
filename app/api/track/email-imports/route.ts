import { createTrackerPurchaseStatements, parseTrackerPurchaseInput } from "../../../../lib/tracker-purchases";
import { type EmailImportStatus, type EmailPurchaseReview, type ParsedPurchaseEmail } from "../../../../lib/tracker-email-parser";
import { cleanTrackerText, emailImportItemId, noStoreJson, strictTrackerText, trackerDb, trackerError, trackerUnavailable } from "../../../../lib/tracker";

type ImportRow = { id: string; status: EmailImportStatus; messageId: string | null; originalSender: string; forwardedBy: string; recipient: string; subject: string; originalSubject: string; emailDate: string | null; receivedAt: string; textBody: string; htmlBody: string; attachmentsJson: string; parsedJson: string; reviewJson: string; errorCode: string | null; importedAt: string | null; createdAt: string; updatedAt: string };
type ItemRow = { id: string; emailImportId: string; position: number; parsedJson: string; importedProductId: string | null; importedTransactionId: string | null };
const importSelect = `id, status, message_id AS messageId, original_sender AS originalSender, forwarded_by AS forwardedBy, recipient, subject, original_subject AS originalSubject,
  email_date AS emailDate, received_at AS receivedAt, text_body AS textBody, html_body AS htmlBody, attachments_json AS attachmentsJson,
  parsed_json AS parsedJson, review_json AS reviewJson, error_code AS errorCode, imported_at AS importedAt, created_at AS createdAt, updated_at AS updatedAt`;

function json<T>(value: string, fallback: T): T { try { return JSON.parse(value) as T; } catch { return fallback; } }
function parseReview(value: unknown, currency: string | null) {
  if (!value || typeof value !== "object") return null; const row = value as Record<string, unknown>;
  const supplier = cleanTrackerText(row.supplier, 120, true); const purchaseDate = strictTrackerText(row.purchaseDate, 10, true); const fxRate = cleanTrackerText(row.fxRate, 120) ?? ""; const reviewCurrency = cleanTrackerText(row.currency ?? currency ?? "", 3)?.toUpperCase() ?? "";
  if (!supplier || !purchaseDate || !Array.isArray(row.items) || !row.items.length ||
      (reviewCurrency && !["DKK", "EUR", "USD", "GBP", "SEK", "NOK"].includes(reviewCurrency)) ||
      (reviewCurrency !== "DKK" && !/^\d{1,8}(?:[.,]\d{1,8})?$/.test(fxRate))) return null;
  const orderNumber = cleanTrackerText(row.orderNumber ?? "", 120) ?? ""; const invoiceNumber = cleanTrackerText(row.invoiceNumber ?? "", 120) ?? "";
  const documentTotals = row.documentTotals && typeof row.documentTotals === "object" ? Object.fromEntries(Object.entries(row.documentTotals as Record<string, unknown>).map(([key, item]) => [key, cleanTrackerText(item, 40) ?? ""])) : {};
  const items: EmailPurchaseReview["items"] = [];
  for (const item of row.items) {
    if (!item || typeof item !== "object") return null; const input = item as Record<string, unknown>;
    if (input.unitPriceOre === null || input.unitPriceOre === undefined || input.unitPriceOre === "" ||
        input.shippingOre === null || input.shippingOre === undefined || input.shippingOre === "") return null;
    const purchase = parseTrackerPurchaseInput({ name: input.name, quantity: input.quantity, unitPriceOre: input.unitPriceOre, shippingOre: input.shippingOre,
      supplier, supplierCountry: input.supplierCountry, occurredAt: purchaseDate, notes: input.notes ?? "", priceMode: input.priceMode,
      vatTreatment: input.vatTreatment, vatRateBps: input.vatRateBps, inputVatOre: input.inputVatOre, outputVatOre: input.outputVatOre, deductibleVatOre: input.deductibleVatOre });
    if (!purchase) return null;
    const sourceItemId = strictTrackerText(input.sourceItemId, 100);
    items.push({ sourceItemId: sourceItemId || null, name: purchase.name, quantity: purchase.quantity, unitPriceOre: purchase.unitPriceOre, shippingOre: purchase.shippingOre,
      supplierCountry: purchase.supplierCountry, priceMode: purchase.priceMode, vatTreatment: purchase.vatTreatment, vatRateBps: purchase.vatRateBps,
      inputVatOre: purchase.inputVatOre, outputVatOre: purchase.outputVatOre, deductibleVatOre: purchase.deductibleVatOre });
  }
  return { supplier, purchaseDate, fxRate, orderNumber, invoiceNumber, currency: reviewCurrency, documentTotals, items } satisfies EmailPurchaseReview;
}

async function listImports(db: D1Database) {
  const [imports, items] = await Promise.all([
    db.prepare(`SELECT ${importSelect} FROM tracker_email_imports ORDER BY received_at DESC, created_at DESC`).all<ImportRow>(),
    db.prepare(`SELECT id, email_import_id AS emailImportId, position, parsed_json AS parsedJson, imported_product_id AS importedProductId, imported_transaction_id AS importedTransactionId FROM tracker_email_import_items ORDER BY position`).all<ItemRow>(),
  ]);
  return imports.results.map((entry) => ({ ...entry, attachments: json(entry.attachmentsJson, []), parsed: json<ParsedPurchaseEmail>(entry.parsedJson, {} as ParsedPurchaseEmail), review: json<EmailPurchaseReview>(entry.reviewJson, { supplier: "", purchaseDate: "", fxRate: "", items: [] }),
    items: items.results.filter((item) => item.emailImportId === entry.id).map((item) => ({ ...item, parsed: json(item.parsedJson, {}) })) }));
}

export async function GET() {
  const db = trackerDb(); if (!db) return trackerUnavailable();
  try { return noStoreJson({ imports: await listImports(db) }); }
  catch (error) { return trackerError(error, "Unable to load email imports.", "EMAIL_IMPORTS_LOAD_FAILED"); }
}

export async function PATCH(request: Request) {
  const db = trackerDb(); if (!db) return trackerUnavailable();
  try {
    const payload = await request.json() as Record<string, unknown>; const id = strictTrackerText(payload.id, 100, true); const action = strictTrackerText(payload.action, 20, true);
    if (!id || !action) return noStoreJson({ error: "Email import request is invalid.", errorCode: "EMAIL_IMPORT_INVALID" }, { status: 400 });
    const entry = await db.prepare(`SELECT ${importSelect} FROM tracker_email_imports WHERE id = ?`).bind(id).first<ImportRow>();
    if (!entry) return noStoreJson({ error: "Email import was not found.", errorCode: "EMAIL_IMPORT_NOT_FOUND" }, { status: 404 });
    if (action === "REJECT") {
      if (entry.status === "IMPORTED") return noStoreJson({ error: "An imported purchase cannot be rejected here.", errorCode: "EMAIL_IMPORT_ALREADY_IMPORTED" }, { status: 409 });
      await db.prepare("UPDATE tracker_email_imports SET status = 'REJECTED', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(id).run();
      return noStoreJson({ id, status: "REJECTED" });
    }
    const parsed = json<ParsedPurchaseEmail>(entry.parsedJson, {} as ParsedPurchaseEmail);
    if (action === "REVIEW") {
      const review = parseReview(payload.review, parsed.currency);
      if (!review) {
        await db.prepare("UPDATE tracker_email_imports SET status = 'NEEDS_REVIEW', error_code = 'EMAIL_IMPORT_REVIEW_INCOMPLETE', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status != 'IMPORTED'").bind(id).run();
        return noStoreJson({ error: "The review is incomplete or VAT data is invalid.", errorCode: "EMAIL_IMPORT_REVIEW_INCOMPLETE" }, { status: 400 });
      }
      await db.prepare("UPDATE tracker_email_imports SET status = 'READY', review_json = ?, error_code = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status != 'IMPORTED'").bind(JSON.stringify(review), id).run();
      return noStoreJson({ id, status: "READY" });
    }
    if (action === "IMPORT") {
      if (entry.status === "IMPORTED") return noStoreJson({ error: "This email import has already been imported.", errorCode: "EMAIL_IMPORT_ALREADY_IMPORTED" }, { status: 409 });
      const claimed = await db.prepare("UPDATE tracker_email_imports SET status = 'PROCESSING', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'READY'").bind(id).run();
      if (claimed.meta.changes !== 1) return noStoreJson({ error: "Complete the review before importing this purchase.", errorCode: "EMAIL_IMPORT_NOT_READY" }, { status: 409 });
      try {
        const review = parseReview(json(entry.reviewJson, {}), parsed.currency);
        if (!review) throw new Error("Stored email-import review is invalid.");
        const items = (await db.prepare("SELECT id, position FROM tracker_email_import_items WHERE email_import_id = ? ORDER BY position").bind(id).all<{ id: string; position: number }>()).results;
        const itemIds = new Set(items.map((item) => item.id)); if (review.items.some((item) => item.sourceItemId && !itemIds.has(item.sourceItemId))) throw new Error("Email-import review refers to an unknown line item.");
        const created = review.items.map((item) => createTrackerPurchaseStatements(db, parseTrackerPurchaseInput({ ...item, supplier: review.supplier, occurredAt: review.purchaseDate,
          notes: `Email import ${id}${review.orderNumber ? ` · Order ${review.orderNumber}` : review.invoiceNumber ? ` · Invoice ${review.invoiceNumber}` : ""}` })!));
        await db.batch([
          ...created.flatMap((purchase) => purchase.statements),
          ...created.map((purchase, index) => review.items[index].sourceItemId
            ? db.prepare("UPDATE tracker_email_import_items SET imported_product_id = ?, imported_transaction_id = ? WHERE id = ?")
              .bind(purchase.productId, purchase.transactionId, review.items[index].sourceItemId)
            : db.prepare("INSERT INTO tracker_email_import_items (id, email_import_id, position, parsed_json, imported_product_id, imported_transaction_id) VALUES (?, ?, ?, ?, ?, ?)")
              .bind(emailImportItemId(), id, items.length + index, JSON.stringify({ source: "manual_review_line" }), purchase.productId, purchase.transactionId)),
          db.prepare("UPDATE tracker_email_imports SET status = 'IMPORTED', imported_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'PROCESSING'").bind(id),
        ]);
        return noStoreJson({ id, status: "IMPORTED", transactionIds: created.map((purchase) => purchase.transactionId) });
      } catch (error) {
        await db.prepare("UPDATE tracker_email_imports SET status = 'FAILED', error_code = 'EMAIL_IMPORT_UPDATE_FAILED', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'PROCESSING'").bind(id).run();
        throw error;
      }
    }
    return noStoreJson({ error: "Email import action is invalid.", errorCode: "EMAIL_IMPORT_INVALID" }, { status: 400 });
  } catch (error) { return trackerError(error, "Unable to update the email import.", "EMAIL_IMPORT_UPDATE_FAILED"); }
}
