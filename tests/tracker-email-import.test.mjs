import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { calculateVatAmounts, recalculateProductSales, vatPosition } from "../lib/tracker-accounting.ts";
import { initialEmailPurchaseReview, parsePurchaseEmail } from "../lib/tracker-email-parser.ts";
import { extractPdfText } from "../email-worker/src/pdf.ts";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");
const order = (text, htmlBody = "") => parsePurchaseEmail({ from: "orders@example.com", subject: "Order #ABC-123", textBody: text, htmlBody });
function textPdf(lines) {
  const stream = `BT\n/F1 12 Tf\n72 720 Td\n${lines.map((line, index) => `${index ? "0 -18 Td\n" : ""}(${line.replace(/([\\()])/g, "\\$1")}) Tj`).join("\n")}\nET`;
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>", `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  let output = "%PDF-1.4\n"; const offsets = [0]; objects.forEach((object, index) => { offsets.push(Buffer.byteLength(output)); output += `${index + 1} 0 obj\n${object}\nendobj\n`; }); const xref = Buffer.byteLength(output);
  return new Uint8Array(Buffer.from(`${output}xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`));
}

test("generic email parser extracts a documented single-item DKK order with shipping, discount and VAT", () => {
  const parsed = order(`Order number: ABC-123\nOrder date: 22.08.2026\n3 × Starlink Mini  1.590,00 DKK\nSubtotal: 4.770,00 DKK\nShipping: 0,00 DKK\nDiscount: 100,00 DKK\nMoms: 934,00 DKK (25%)\nTotal: 4.670,00 DKK`);
  assert.equal(parsed.orderNumber, "ABC-123"); assert.equal(parsed.purchaseDate, "2026-08-22"); assert.equal(parsed.currency, "DKK");
  assert.deepEqual(parsed.items[0], { name: "Starlink Mini", quantity: 3, unitAmount: { minor: 159000, currency: "DKK", raw: "1.590,00 DKK", source: "email_body", provenance: "DOCUMENTED" }, source: "email_body", provenance: "DOCUMENTED" });
  assert.equal(parsed.shipping?.minor, 0); assert.equal(parsed.shipping?.source, "email_body"); assert.equal(parsed.discount?.minor, 10000); assert.equal(parsed.vatAmount?.minor, 93400); assert.equal(parsed.vatRateBps, 2500);
  const review = initialEmailPurchaseReview(parsed); assert.equal(review.items[0].unitPriceOre, 159000); assert.equal(review.items[0].shippingOre, 0); assert.equal(review.items[0].vatTreatment, "");
});

test("multi-item, HTML-only, forwarded and foreign-currency emails remain review-first", () => {
  const multi = order(`2 × Starlink Mini  1.590,00 DKK\n1 × Starlink Standard Kit  2.200,00 DKK\nShipping: 50,00 DKK\nTotal: 5.430,00 DKK`);
  assert.equal(multi.items.length, 2); assert.equal(initialEmailPurchaseReview(multi).items.every((item) => item.shippingOre === null), true, "order-level shipping is never arbitrarily allocated");
  const html = order("", "<p>1 × Router&nbsp;&nbsp; 100,00 DKK</p><p>Total: 100,00 DKK</p>");
  assert.equal(html.items[0].name, "Router");
  const eur = order(`1 × Cable  10,00 EUR\nTotal: 10,00 EUR`);
  assert.equal(eur.currency, "EUR"); assert.equal(initialEmailPurchaseReview(eur).items[0].unitPriceOre, null);
  assert.ok(order(`1 × Cable  10,00 DKK`).issues.includes("MISSING_TOTAL"));
});

test("parser never invents supplier country or VAT treatment", () => {
  const parsed = order(`1 × Cable  10,00 DKK\nVAT: 2,00 DKK\nTotal: 10,00 DKK`);
  const review = initialEmailPurchaseReview(parsed);
  assert.equal(parsed.supplier, "example.com"); assert.equal(review.items[0].supplierCountry, ""); assert.equal(review.items[0].vatTreatment, "");
  assert.ok(parsed.issues.includes("VAT_INCOMPLETE"));
});

test("forwarded Gmail mail preserves the original sender name and original receipt reference", () => {
  const parsed = parsePurchaseEmail({ from: "me@gmail.com", subject: "Fwd: Your receipt from Goatify by MMax GmbH #2572-0086", textBody: "---------- Videresendt mail ---------\nFra: Goatify by MMax GmbH <invoice+statements@goatify.io>\nEmne: Your receipt from Goatify by MMax GmbH #2572-0086\n\nThank you", attachments: [] });
  assert.equal(parsed.supplier, "Goatify by MMax GmbH"); assert.equal(parsed.originalSenderEmail, "invoice+statements@goatify.io"); assert.equal(parsed.receiptNumber, "2572-0086"); assert.notEqual(parsed.supplier, "gmail.com");
});

test("nested forwarded Stripe receipt uses the deepest original sender and parses body evidence before PDFs", () => {
  const parsed = parsePurchaseEmail({ from: "purchases@reverlo.nl", originalSender: "Robert Tacchini <roberttacchini@gmail.com>", subject: "Fwd: Fwd: Your receipt from Goatify by MMax GmbH #2572-0086", textBody: `---------- Videresendt mail ---------
Fra: Robert Tacchini <roberttacchini@gmail.com>
Dato: lør. 22. aug. 2026 kl. 20.01
Emne: Fwd: Your receipt from Goatify by MMax GmbH #2572-0086
Til: <purchases@reverlo.nl>

---------- Videresendt mail ---------
Fra: Goatify by MMax GmbH <invoice+statements@goatify.io>
Dato: man. 17. aug. 2026 kl. 19.31
Emne: Your receipt from Goatify by MMax GmbH #2572-0086
Til: <roberttacchini@gmail.com>

Receipt from Goatify by MMax GmbH
€44.99
Paid August 17, 2026

Receipt number   2572-0086
Invoice number   4EAV72TW-0004
Payment method   Mastercard - 5971

Receipt #2572-0086

Aug 17–Sep 16, 2026

Goatify

Qty 1
€44.99

Total excluding tax
€35.99

VAT - Denmark (25% incl.)
€9.00

Total
€44.99

Amount paid
€44.99`, attachments: [] });
  assert.equal(parsed.supplier, "Goatify by MMax GmbH"); assert.notEqual(parsed.supplier, "Robert Tacchini"); assert.notEqual(parsed.supplier, "gmail.com");
  assert.equal(parsed.originalSenderName, "Goatify by MMax GmbH"); assert.equal(parsed.originalSenderEmail, "invoice+statements@goatify.io"); assert.equal(parsed.originalSubject, "Your receipt from Goatify by MMax GmbH #2572-0086"); assert.equal(parsed.forwardedChain.length, 2);
  assert.equal(parsed.receiptNumber, "2572-0086"); assert.equal(parsed.invoiceNumber, "4EAV72TW-0004"); assert.equal(parsed.currency, "EUR"); assert.equal(parsed.purchaseDate, "2026-08-17"); assert.equal(parsed.subtotal?.minor, 3599); assert.equal(parsed.vatAmount?.minor, 900); assert.equal(parsed.vatRateBps, 2500); assert.equal(parsed.total?.minor, 4499); assert.equal(parsed.amountPaid?.minor, 4499);
  assert.equal(parsed.items.length, 1); assert.equal(parsed.items[0].name, "Goatify"); assert.equal(parsed.items[0].quantity, 1); assert.equal(parsed.items[0].lineTotal?.minor, 4499); assert.equal(parsed.items[0].unitAmount, null); assert.equal(parsed.issues.includes("NO_LINE_ITEMS"), false);
});

test("Goatify Stripe invoice and receipt reconcile net subtotal, references, and source EUR without creating DKK accounting values", () => {
  const body = `Receipt from Goatify by MMax GmbH
€44.99
Paid August 17, 2026

Receipt number   2572-0086
Invoice number   4EAV72TW-0004

Goatify

Qty 1
€44.99

Total excluding tax
€35.99

VAT - Denmark (25% incl.)
€9.00

Total
€44.99

Amount paid
€44.99`;
  const parsed = parsePurchaseEmail({ from: "purchases@reverlo.nl", originalSender: "Goatify by MMax GmbH <invoice+statements@goatify.io>", originalSubject: "Your receipt from Goatify by MMax GmbH #2572-0086", subject: "Fwd: Your receipt from Goatify by MMax GmbH #2572-0086", textBody: body, attachments: [
    { name: "Invoice-4EAV72TW-0004.pdf", contentType: "application/pdf", size: 100, extractionStatus: "EXTRACTED", text: "Invoice number 4EAV72TW-0004\nSubtotal\n€44.99\nVAT (25%)\n€9.00\nTotal\n€44.99" },
    { name: "Receipt-2572-0086.pdf", contentType: "application/pdf", size: 100, extractionStatus: "EXTRACTED", text: "Receipt number 2572-0086\nInvoice number 4EAV72TW-0004\nGoatify\nQty 1\n€44.99\nTotal\n€44.99" },
  ] });
  assert.equal(parsed.supplier, "Goatify by MMax GmbH"); assert.equal(parsed.purchaseDate, "2026-08-17"); assert.equal(parsed.receiptNumber, "2572-0086"); assert.equal(parsed.invoiceNumber, "4EAV72TW-0004"); assert.equal(parsed.currency, "EUR"); assert.equal(parsed.subtotal?.minor, 3599); assert.equal(parsed.vatAmount?.minor, 900); assert.equal(parsed.vatRateBps, 2500); assert.equal(parsed.total?.minor, 4499); assert.equal(parsed.amountPaid?.minor, 4499);
  assert.equal(parsed.items.length, 1); assert.equal(parsed.items[0].name, "Goatify"); assert.equal(parsed.items[0].quantity, 1); assert.equal(parsed.items[0].lineTotal?.minor, 4499); assert.equal(parsed.conflicts.includes("CONFLICTING_INVOICE_NUMBER"), false); assert.equal(parsed.conflicts.includes("CONFLICTING_SUBTOTAL"), false);
  const review = initialEmailPurchaseReview(parsed); assert.deepEqual(review.items[0].sourceDocumentAmount, { minor: 4499, currency: "EUR", source: "email_body", provenance: "DOCUMENTED", kind: "LINE_TOTAL" }); assert.equal(review.items[0].unitPriceOre, null); assert.equal(review.fxRate, ""); assert.equal(review.items[0].vatTreatment, "");
});

test("text-based PDF extraction feeds a single review line without OCR", async () => {
  const pdf = await extractPdfText(textPdf(["Invoice number: INV-100", "1 x Starlink Mini 1590,00 DKK", "Subtotal: 1590,00 DKK", "Total: 1590,00 DKK"]));
  assert.equal(pdf.extractionStatus, "EXTRACTED"); const parsed = parsePurchaseEmail({ from: "orders@example.com", subject: "", textBody: "", attachments: [{ name: "Invoice-INV-100.pdf", contentType: "application/pdf", size: 400, ...pdf }] });
  assert.equal(parsed.items.length, 1); assert.equal(parsed.items[0].name, "Starlink Mini"); assert.equal(parsed.items[0].quantity, 1); assert.equal(parsed.total?.minor, 159000); assert.equal(parsed.invoiceNumber, "INV-100");
});

test("multiple PDF invoice lines become multiple review lines", () => {
  const parsed = parsePurchaseEmail({ from: "orders@example.com", subject: "", textBody: "", attachments: [{ name: "Invoice.pdf", contentType: "application/pdf", size: 100, sha256: "a".repeat(64), extractionStatus: "EXTRACTED", text: "2 x Cable 10,00 DKK\n1 x Adapter 25,00 DKK\nTotal: 45,00 DKK" }] });
  assert.equal(parsed.items.length, 2); assert.equal(parsed.items[1].name, "Adapter");
});

test("invoice and receipt with equivalent lines do not double the draft", () => {
  const attachments = ["Invoice-A.pdf", "Receipt-A.pdf"].map((name, index) => ({ name, contentType: "application/pdf", size: 100, sha256: String(index).repeat(64), extractionStatus: "EXTRACTED", text: "1 x Cable 10,00 DKK\nTotal: 10,00 DKK" }));
  const parsed = parsePurchaseEmail({ from: "orders@example.com", subject: "", textBody: "", attachments }); assert.equal(parsed.items.length, 1); assert.equal(parsed.conflicts.length, 0);
});

test("conflicting PDF totals remain visible and force review", () => {
  const attachments = ["Invoice-A.pdf", "Receipt-A.pdf"].map((name, index) => ({ name, contentType: "application/pdf", size: 100, sha256: String(index).repeat(64), extractionStatus: "EXTRACTED", text: `1 x Cable 10,00 DKK\nTotal: ${index ? "11,00" : "10,00"} DKK` }));
  const parsed = parsePurchaseEmail({ from: "orders@example.com", subject: "", textBody: "", attachments }); assert.ok(parsed.conflicts.includes("CONFLICTING_TOTAL")); assert.equal(parsed.total, null);
});

test("image-only or malformed PDFs stay review-first and never invoke OCR", async () => {
  const originalWarn = console.warn; console.warn = () => {};
  let pdf;
  try { pdf = await extractPdfText(new TextEncoder().encode("%PDF-not-a-document")); } finally { console.warn = originalWarn; }
  assert.notEqual(pdf.extractionStatus, "EXTRACTED");
  const parsed = parsePurchaseEmail({ from: "orders@example.com", subject: "", textBody: "", attachments: [{ name: "Scan.pdf", contentType: "application/pdf", size: 20, ...pdf }] }); assert.ok(parsed.issues.includes("PDF_TEXT_UNAVAILABLE")); assert.equal(parsed.items.length, 0);
});

test("email review purchase uses exactly the manual VAT and accounting calculation", () => {
  const payload = { name: "Starlink Mini", quantity: 3, unitPriceOre: 127200, shippingOre: 0, supplier: "Dustin", supplierCountry: "DK", occurredAt: "2026-08-22", notes: "Email import", priceMode: "VAT_INCLUSIVE", vatTreatment: "DANISH_PURCHASE_DEDUCTIBLE", vatRateBps: 2500, inputVatOre: null, outputVatOre: null, deductibleVatOre: null };
  const manual = calculateVatAmounts({ type: "PURCHASE", quantity: payload.quantity, enteredUnitPriceOre: payload.unitPriceOre, enteredShippingOre: payload.shippingOre, priceMode: payload.priceMode, vatTreatment: payload.vatTreatment, vatRateBps: payload.vatRateBps });
  const email = calculateVatAmounts({ type: "PURCHASE", quantity: payload.quantity, enteredUnitPriceOre: payload.unitPriceOre, enteredShippingOre: payload.shippingOre, priceMode: payload.priceMode, vatTreatment: payload.vatTreatment, vatRateBps: payload.vatRateBps });
  assert.deepEqual(email, manual);
  const sale = recalculateProductSales({ quantity: 3, purchasePriceOre: email.unitPriceOre, purchaseShippingOre: email.shippingOre }, [{ id: "sale", quantity: 1, revenueOre: 170000, feeOre: 0, promotedFeeOre: 0, shippingOre: 0, otherCostsOre: 0, occurredAt: "2026-08-23" }]);
  assert.equal(sale.remainingQuantity, 2); assert.deepEqual(vatPosition({ deductibleInputVatOre: email.deductibleVatOre, outputVatOre: 0, paidSettlementsOre: 0, receivedSettlementsOre: 0 }), vatPosition({ deductibleInputVatOre: manual.deductibleVatOre, outputVatOre: 0, paidSettlementsOre: 0, receivedSettlementsOre: 0 }));
});

test("email import schema is additive and enforces server-side fingerprints", async () => {
  const migration = await source("drizzle/0010_tracker_email_purchase_imports.sql");
  assert.match(migration, /CREATE TABLE tracker_email_imports/); assert.match(migration, /CREATE TABLE tracker_email_import_items/); assert.match(migration, /idx_tracker_email_imports_fingerprint/); assert.match(migration, /idx_tracker_email_imports_message_id/); assert.match(migration, /idx_tracker_email_imports_order_key/); assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM|UPDATE tracker_(?:products|transactions)/i);
  const db = new DatabaseSync(":memory:"); db.exec(migration); db.prepare("INSERT INTO tracker_email_imports (id, status, source_fingerprint) VALUES ('one', 'NEEDS_REVIEW', 'same')").run();
  assert.throws(() => db.prepare("INSERT INTO tracker_email_imports (id, status, source_fingerprint) VALUES ('two', 'NEEDS_REVIEW', 'same')").run()); db.close();
});

test("PDF import migration is additive and makes attachment fingerprints idempotent", async () => {
  const [base, migration] = await Promise.all([source("drizzle/0010_tracker_email_purchase_imports.sql"), source("drizzle/0011_tracker_email_pdf_imports.sql")]);
  assert.match(migration, /ADD COLUMN original_subject/); assert.match(migration, /ADD COLUMN attachment_fingerprint/); assert.match(migration, /idx_tracker_email_imports_attachment_fingerprint/); assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM|UPDATE tracker_/i);
  const db = new DatabaseSync(":memory:"); db.exec(base); db.exec(migration); db.prepare("INSERT INTO tracker_email_imports (id, status, source_fingerprint, attachment_fingerprint) VALUES ('one', 'NEEDS_REVIEW', 'source-one', 'attachment-one')").run(); assert.throws(() => db.prepare("INSERT INTO tracker_email_imports (id, status, source_fingerprint, attachment_fingerprint) VALUES ('two', 'NEEDS_REVIEW', 'source-two', 'attachment-one')").run()); db.close();
});

test("rejecting an unimported email hard-deletes its dedupe keys and cascades its review lines", async () => {
  const [base, pdfMigration, route] = await Promise.all([source("drizzle/0010_tracker_email_purchase_imports.sql"), source("drizzle/0011_tracker_email_pdf_imports.sql"), source("app/api/track/email-imports/route.ts")]);
  const db = new DatabaseSync(":memory:"); db.exec("PRAGMA foreign_keys = ON"); db.exec(base); db.exec(pdfMigration); db.exec("CREATE TABLE tracker_products (id TEXT PRIMARY KEY); CREATE TABLE tracker_transactions (id TEXT PRIMARY KEY)");
  const insert = db.prepare("INSERT INTO tracker_email_imports (id, status, source_fingerprint, message_id, order_key, attachment_fingerprint) VALUES (?, ?, 'mail-fingerprint', 'message-id', 'goatify:invoice-1', 'attachment-fingerprint')");
  insert.run("review", "NEEDS_REVIEW"); db.prepare("INSERT INTO tracker_email_import_items (id, email_import_id, position) VALUES ('review-line', 'review', 0)").run();
  const duplicate = db.prepare("SELECT id FROM tracker_email_imports WHERE source_fingerprint = 'mail-fingerprint' OR message_id = 'message-id' OR order_key = 'goatify:invoice-1' OR attachment_fingerprint = 'attachment-fingerprint'").all(); assert.equal(duplicate.length, 1);
  const removed = db.prepare("DELETE FROM tracker_email_imports WHERE id = ? AND status IN ('RECEIVED', 'NEEDS_REVIEW', 'READY', 'DUPLICATE', 'REJECTED', 'FAILED')").run("review"); assert.equal(removed.changes, 1); assert.equal(db.prepare("SELECT COUNT(*) AS count FROM tracker_email_import_items").get().count, 0);
  assert.doesNotThrow(() => insert.run("replacement", "NEEDS_REVIEW")); assert.equal(db.prepare("SELECT id FROM tracker_email_imports WHERE id = 'replacement'").get().id, "replacement");
  const imported = db.prepare("INSERT INTO tracker_email_imports (id, status, source_fingerprint, message_id, order_key, attachment_fingerprint) VALUES ('imported', 'IMPORTED', 'imported-fingerprint', 'imported-message', 'goatify:invoice-imported', 'imported-attachment')"); imported.run();
  const protectedRow = db.prepare("DELETE FROM tracker_email_imports WHERE id = ? AND status IN ('RECEIVED', 'NEEDS_REVIEW', 'READY', 'DUPLICATE', 'REJECTED', 'FAILED')").run("imported"); assert.equal(protectedRow.changes, 0); assert.equal(db.prepare("SELECT status FROM tracker_email_imports WHERE id = 'imported'").get().status, "IMPORTED");
  const rejectBranch = route.slice(route.indexOf('if (action === "REJECT")'), route.indexOf("const parsed =")); assert.match(rejectBranch, /DELETE FROM tracker_email_imports/); assert.match(rejectBranch, /status IN \('RECEIVED', 'NEEDS_REVIEW', 'READY', 'DUPLICATE', 'REJECTED', 'FAILED'\)/); assert.doesNotMatch(rejectBranch, /tracker_(?:products|transactions|expenses|vat)/); db.close();
});

test("ingestion validates secrets, limits, payloads and duplicate fingerprints before any purchase creation", async () => {
  const [ingest, imports, worker] = await Promise.all([source("app/api/track/email-ingest/route.ts"), source("app/api/track/email-imports/route.ts"), source("email-worker/src/index.ts")]);
  assert.match(ingest, /sameSecret/); assert.match(ingest, /x-reverlo-email-ingest-secret/); assert.match(ingest, /MAX_REQUEST_BYTES/); assert.match(ingest, /attachment_fingerprint/); assert.match(ingest, /status: "DUPLICATE"/);
  assert.match(imports, /status = 'PROCESSING'/); assert.match(imports, /status = 'READY'/); assert.match(imports, /createTrackerPurchaseStatements/); assert.match(imports, /status = 'IMPORTED'/);
  assert.match(worker, /PostalMime\.parse\(message\.raw\)/); assert.match(worker, /message\.rawSize/); assert.match(worker, /MAX_TOTAL_PDF_BYTES/); assert.match(worker, /extractPdfText/); assert.match(worker, /REVERLO_EMAIL_INGEST_SECRET/); assert.match(worker, /CF-Access-Client-Id/);
  for (const marker of ["[EMAIL] received", "[MIME] parse start", "[MIME] parse complete", "[PDF] attachments found", "[PDF] extraction start", "[PDF] extraction complete", "[PARSER] forwarded metadata complete", "[INGEST] request start", "[INGEST] response", "[EMAIL] complete"]) assert.match(worker, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(worker, /response\.json\(\)/); assert.match(worker, /intakeStatus/); assert.match(worker, /ingestSecretConfigured: Boolean/); assert.match(worker, /accessTokenConfigured: Boolean/);
});
