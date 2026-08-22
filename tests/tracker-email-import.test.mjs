import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { calculateVatAmounts, recalculateProductSales, vatPosition } from "../lib/tracker-accounting.ts";
import { initialEmailPurchaseReview, parsePurchaseEmail } from "../lib/tracker-email-parser.ts";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");
const order = (text, htmlBody = "") => parsePurchaseEmail({ from: "orders@example.com", subject: "Order #ABC-123", textBody: text, htmlBody });

test("generic email parser extracts a documented single-item DKK order with shipping, discount and VAT", () => {
  const parsed = order(`Order number: ABC-123\nOrder date: 22.08.2026\n3 × Starlink Mini  1.590,00 DKK\nSubtotal: 4.770,00 DKK\nShipping: 0,00 DKK\nDiscount: 100,00 DKK\nMoms: 934,00 DKK (25%)\nTotal: 4.670,00 DKK`);
  assert.equal(parsed.orderNumber, "ABC-123"); assert.equal(parsed.purchaseDate, "2026-08-22"); assert.equal(parsed.currency, "DKK");
  assert.deepEqual(parsed.items[0], { name: "Starlink Mini", quantity: 3, unitAmount: { minor: 159000, currency: "DKK", raw: "1.590,00 DKK", source: "email_line_item", provenance: "DOCUMENTED" }, source: "email_line_item", provenance: "DOCUMENTED" });
  assert.equal(parsed.shipping?.minor, 0); assert.equal(parsed.shipping?.source, "email_summary_shipping"); assert.equal(parsed.discount?.minor, 10000); assert.equal(parsed.vatAmount?.minor, 93400); assert.equal(parsed.vatRateBps, 2500);
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

test("ingestion validates secrets, limits, payloads and duplicate fingerprints before any purchase creation", async () => {
  const [ingest, imports, worker] = await Promise.all([source("app/api/track/email-ingest/route.ts"), source("app/api/track/email-imports/route.ts"), source("email-worker/src/index.ts")]);
  assert.match(ingest, /sameSecret/); assert.match(ingest, /x-reverlo-email-ingest-secret/); assert.match(ingest, /MAX_REQUEST_BYTES/); assert.match(ingest, /source_fingerprint/); assert.match(ingest, /status: "DUPLICATE"/);
  assert.match(imports, /status = 'PROCESSING'/); assert.match(imports, /status = 'READY'/); assert.match(imports, /createTrackerPurchaseStatements/); assert.match(imports, /status = 'IMPORTED'/);
  assert.match(worker, /PostalMime\.parse\(message\.raw\)/); assert.match(worker, /message\.rawSize/); assert.match(worker, /REVERLO_EMAIL_INGEST_SECRET/); assert.match(worker, /CF-Access-Client-Id/);
});
