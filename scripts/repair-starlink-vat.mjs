#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const PRODUCT_OLD_ID = "1786376495960";
const SALE_OLD_ID = "1786550183872";
const PRODUCT_ID = `prd_rst_${PRODUCT_OLD_ID}`;
const PURCHASE_ID = `txn_rst_purchase_${PRODUCT_OLD_ID}`;
const SALE_ID = `txn_rst_sale_${SALE_OLD_ID}`;

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function extractAndValidate(data) {
  const product = Array.isArray(data.inventory) ? data.inventory.find((row) => String(row?.id) === PRODUCT_OLD_ID) : null;
  const sale = Array.isArray(data.sales) ? data.sales.find((row) => String(row?.id) === SALE_OLD_ID) : null;
  const problems = [];
  const expect = (condition, message) => { if (!condition) problems.push(message); };
  expect(product, `Inventory ${PRODUCT_OLD_ID} is missing.`);
  expect(sale, `Sale ${SALE_OLD_ID} is missing.`);
  if (product) {
    expect(product.name === "Starlink Mini", "Unexpected product name.");
    expect(product.purchaseQty === 3 && product.qty === 0, "Expected 3 purchased and 0 remaining units.");
    expect(product.currency === "DKK" && product.shippingCurrency === "DKK", "Purchase is not explicitly DKK.");
    expect(product.purchaseType === "business-vat", "Purchase is not marked business-vat.");
    expect(product.grossBuyPrice === 1561.25 && product.grossShipping === 86.25, "Gross purchase fields changed.");
    expect(product.rawBuyPrice === 1249 && product.rawShipping === 69, "Net purchase fields changed.");
    expect(product.cashPaid === 4770 && product.netCost === 3816 && product.inputVat === 954 && product.recoverableVat === 954, "Purchase VAT reconciliation fields changed.");
  }
  if (sale) {
    expect(String(sale.productId) === PRODUCT_OLD_ID && sale.qty === 3, "Sale relation or quantity changed.");
    expect(sale.salePrice === 5809.15 && sale.revenueDkk === 5809.15, "Sale revenue changed.");
    expect(sale.vatTreatment === "eu-b2b-reverse-charge" && sale.vatType === "EU_B2B" && sale.vatRate === 0 && sale.outputVat === 0, "Sale VAT treatment changed.");
    expect(sale.customerType === "business" && sale.customerCountry === "DE" && sale.customerVatNumber === "DE365090680" && sale.customerVatVerified === true, "EU B2B customer evidence changed.");
    expect(sale.costPrice === 3816 && sale.shipping === 170 && sale.fee === 0 && sale.profit === 1823.15, "Sale profit inputs changed.");
  }
  if (problems.length) throw new Error(`Source validation failed:\n- ${problems.join("\n- ")}`);
  return { product, sale };
}

function repairHash(records) {
  return createHash("sha256").update(stableStringify({ version: 1, product: records.product, sale: records.sale })).digest("hex");
}

function repairSql() {
  // One UPDATE statement with a global two-record guard: either both exact
  // imported rows match, or neither row is changed.
  return `-- Starlink Mini VAT metadata repair; does not change product cost or profit.
UPDATE tracker_transactions
SET notes = CASE id WHEN '${SALE_ID}' THEN 'B2B Salg' ELSE notes END,
    entered_unit_price_ore = CASE id WHEN '${PURCHASE_ID}' THEN 156125 ELSE 193638 END,
    entered_shipping_ore = CASE id WHEN '${PURCHASE_ID}' THEN 8625 ELSE 17000 END,
    entered_total_price_ore = CASE id WHEN '${SALE_ID}' THEN 580915 ELSE entered_total_price_ore END,
    price_mode = CASE id WHEN '${PURCHASE_ID}' THEN 'VAT_INCLUSIVE' ELSE 'VAT_EXCLUSIVE' END,
    vat_treatment = CASE id WHEN '${PURCHASE_ID}' THEN 'CUSTOM_MANUAL' ELSE 'EU_B2B_SALE_REVERSE_CHARGE' END,
    vat_rate_bps = CASE id WHEN '${PURCHASE_ID}' THEN 2500 ELSE 0 END,
    gross_amount_ore = CASE id WHEN '${PURCHASE_ID}' THEN 477000 ELSE 580915 END,
    input_vat_ore = CASE id WHEN '${PURCHASE_ID}' THEN 95400 ELSE 0 END,
    output_vat_ore = 0,
    deductible_vat_ore = CASE id WHEN '${PURCHASE_ID}' THEN 95400 ELSE 0 END,
    customer_country = CASE id WHEN '${SALE_ID}' THEN 'DE' ELSE customer_country END,
    is_b2b = CASE id WHEN '${SALE_ID}' THEN 1 ELSE is_b2b END,
    vat_id_reference = CASE id WHEN '${SALE_ID}' THEN 'DE365090680' ELSE vat_id_reference END,
    updated_at = CURRENT_TIMESTAMP
WHERE id IN ('${PURCHASE_ID}', '${SALE_ID}')
  AND 2 = (
    SELECT COUNT(*) FROM tracker_transactions
    WHERE (id = '${PURCHASE_ID}' AND product_id = '${PRODUCT_ID}' AND type = 'PURCHASE'
      AND quantity = 3 AND unit_price_ore = 124900 AND shipping_ore = 6900
      AND cost_basis_ore = 381600 AND total_costs_ore = 381600 AND vat_treatment IS NULL)
       OR (id = '${SALE_ID}' AND product_id = '${PRODUCT_ID}' AND type = 'SALE'
      AND quantity = 3 AND revenue_ore = 580915 AND cost_basis_ore = 381600
      AND shipping_ore = 17000 AND fee_ore = 0 AND promoted_fee_ore = 0
      AND other_costs_ore = 0 AND total_costs_ore = 398600 AND net_profit_ore = 182315
      AND vat_treatment IS NULL)
  );
`;
}

function parseArgs(argv) {
  const options = { file: "", apply: false, remote: false, local: false, confirm: "", database: "reverlo-db" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") options.apply = true;
    else if (arg === "--remote") options.remote = true;
    else if (arg === "--local") options.local = true;
    else if (arg === "--confirm") options.confirm = argv[++index] ?? "";
    else if (arg === "--database") options.database = argv[++index] ?? "";
    else if (arg.startsWith("--")) throw new Error(`Unknown option: ${arg}`);
    else if (options.file) throw new Error("Provide exactly one ResellTrack JSON file.");
    else options.file = arg;
  }
  if (!options.file) throw new Error("Usage: npm run tracker:repair-starlink-vat -- <reselltrack-data.json> [--apply (--local|--remote) --confirm <hash>]");
  if (options.remote && options.local) throw new Error("Choose either --local or --remote.");
  if (options.apply && !options.remote && !options.local) throw new Error("--apply requires an explicit --local or --remote target.");
  if (!options.apply && (options.remote || options.local || options.confirm)) throw new Error("Target and confirmation flags are valid only with --apply.");
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const data = JSON.parse(await readFile(options.file, "utf8"));
  const records = extractAndValidate(data);
  const hash = repairHash(records);
  console.log(`${options.apply ? "STARLINK VAT REPAIR" : "DRY RUN — no D1 writes"}\n`);
  console.log(`Product: Starlink Mini (${PRODUCT_ID})`);
  console.log("Purchase: gross DKK 4,770.00; net cost DKK 3,816.00; deductible input VAT DKK 954.00");
  console.log("Purchase treatment: CUSTOM_MANUAL (the source proves the VAT amounts, but does not state supplier country)");
  console.log("Sale: EU B2B reverse charge; revenue DKK 5,809.15; output VAT DKK 0.00; trading profit unchanged at DKK 1,823.15");
  console.log("VAT position change: DKK 954.00 receivable before any separately recorded settlement");
  console.log("Supplier country remains unset because the JSON does not state it explicitly.");
  console.log(`Confirmation hash: ${hash}`);
  if (!options.apply) return;
  if (options.confirm !== hash) throw new Error(`Repair refused. Pass --confirm ${hash} for this exact Starlink source record.`);

  const temporaryDirectory = await mkdtemp(join(tmpdir(), "reverlo-starlink-vat-"));
  const sqlFile = join(temporaryDirectory, "repair.sql");
  try {
    await writeFile(sqlFile, repairSql(), { encoding: "utf8", mode: 0o600 });
    const executable = process.platform === "win32" ? "npx.cmd" : "npx";
    const args = ["wrangler", "d1", "execute", options.database, options.remote ? "--remote" : "--local", `--file=${sqlFile}`, "--yes"];
    const result = spawnSync(executable, args, { cwd: process.cwd(), stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Wrangler exited with status ${result.status}.`);
    console.log("Repair statement completed. Verify both rows in the VAT page before recording a settlement.");
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(`\nRepair failed: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });
