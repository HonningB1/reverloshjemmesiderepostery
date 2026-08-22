import { vatPosition } from "../../../../lib/tracker-accounting";
import {
  noStoreJson, strictTrackerText, trackerDate, trackerDb, trackerError, trackerInteger,
  trackerUnavailable, vatSettlementId,
} from "../../../../lib/tracker";
import type { TrackerVatSettlement, VatSettlementDirection } from "../../../track/types";

const settlementSelect = `id, direction, amount_ore AS amountOre, occurred_at AS occurredAt,
  reference, notes, created_at AS createdAt, updated_at AS updatedAt`;

function direction(value: unknown): VatSettlementDirection | null {
  return value === "PAID" || value === "RECEIVED" ? value : null;
}

function parseSettlement(payload: Record<string, unknown>) {
  const parsedDirection = direction(payload.direction);
  const amountOre = trackerInteger(payload.amountOre, { min: 1 });
  const occurredAt = trackerDate(payload.occurredAt);
  const reference = strictTrackerText(payload.reference ?? "", 120);
  const notes = strictTrackerText(payload.notes ?? "", 2_000);
  return parsedDirection && amountOre !== null && occurredAt && reference !== null && notes !== null
    ? { direction: parsedDirection, amountOre, occurredAt, reference, notes }
    : null;
}

export async function GET() {
  const db = trackerDb();
  if (!db) return trackerUnavailable();
  try {
    const [vat, settlements] = await Promise.all([
      db.prepare(`SELECT
        COALESCE(SUM(CASE WHEN type = 'PURCHASE' THEN input_vat_ore ELSE 0 END), 0) AS inputVatOre,
        COALESCE(SUM(CASE WHEN type = 'PURCHASE' THEN deductible_vat_ore ELSE 0 END), 0) AS deductibleInputVatOre,
        COALESCE(SUM(output_vat_ore), 0) AS outputVatOre
        FROM tracker_transactions`).first<{ inputVatOre: number; deductibleInputVatOre: number; outputVatOre: number }>(),
      db.prepare(`SELECT ${settlementSelect} FROM tracker_vat_settlements
        ORDER BY occurred_at DESC, created_at DESC`).all<TrackerVatSettlement>(),
    ]);
    const inputVatOre = Number(vat?.inputVatOre ?? 0);
    const deductibleInputVatOre = Number(vat?.deductibleInputVatOre ?? 0);
    const outputVatOre = Number(vat?.outputVatOre ?? 0);
    const paidSettlementsOre = settlements.results.reduce((sum, row) => sum + (row.direction === "PAID" ? Number(row.amountOre) : 0), 0);
    const receivedSettlementsOre = settlements.results.reduce((sum, row) => sum + (row.direction === "RECEIVED" ? Number(row.amountOre) : 0), 0);
    return noStoreJson({
      totals: {
        inputVatOre, deductibleInputVatOre, outputVatOre, paidSettlementsOre, receivedSettlementsOre,
        ...vatPosition({ deductibleInputVatOre, outputVatOre, paidSettlementsOre, receivedSettlementsOre }),
      },
      settlements: settlements.results,
    });
  } catch (error) {
    return trackerError(error, "Unable to load VAT.");
  }
}

export async function POST(request: Request) {
  const db = trackerDb();
  if (!db) return trackerUnavailable();
  try {
    const input = parseSettlement(await request.json() as Record<string, unknown>);
    if (!input) return noStoreJson({ error: "Complete the VAT settlement with a direction, amount and date.", errorCode: "INVALID_VAT_SETTLEMENT" }, { status: 400 });
    const id = vatSettlementId();
    await db.prepare(`INSERT INTO tracker_vat_settlements
      (id, direction, amount_ore, occurred_at, reference, notes) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(id, input.direction, input.amountOre, input.occurredAt, input.reference, input.notes).run();
    const settlement = await db.prepare(`SELECT ${settlementSelect} FROM tracker_vat_settlements WHERE id = ?`)
      .bind(id).first<TrackerVatSettlement>();
    return noStoreJson({ settlement }, { status: 201 });
  } catch (error) {
    return trackerError(error, "Unable to record the VAT settlement.");
  }
}

export async function PATCH(request: Request) {
  const db = trackerDb();
  if (!db) return trackerUnavailable();
  try {
    const payload = await request.json() as Record<string, unknown>;
    const id = strictTrackerText(payload.id, 80, true);
    const input = parseSettlement(payload);
    if (!id || !input) return noStoreJson({ error: "The VAT settlement update contains invalid values.", errorCode: "INVALID_VAT_SETTLEMENT" }, { status: 400 });
    const result = await db.prepare(`UPDATE tracker_vat_settlements SET direction = ?, amount_ore = ?, occurred_at = ?,
      reference = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .bind(input.direction, input.amountOre, input.occurredAt, input.reference, input.notes, id).run();
    if (result.meta.changes !== 1) return noStoreJson({ error: "This VAT settlement no longer exists.", errorCode: "VAT_SETTLEMENT_NOT_FOUND" }, { status: 404 });
    const settlement = await db.prepare(`SELECT ${settlementSelect} FROM tracker_vat_settlements WHERE id = ?`)
      .bind(id).first<TrackerVatSettlement>();
    return noStoreJson({ settlement });
  } catch (error) {
    return trackerError(error, "Unable to update the VAT settlement.");
  }
}

export async function DELETE(request: Request) {
  const db = trackerDb();
  if (!db) return trackerUnavailable();
  try {
    const payload = await request.json() as Record<string, unknown>;
    const id = strictTrackerText(payload.id, 80, true);
    if (!id) return noStoreJson({ error: "Invalid VAT settlement.", errorCode: "INVALID_VAT_SETTLEMENT" }, { status: 400 });
    const result = await db.prepare("DELETE FROM tracker_vat_settlements WHERE id = ?").bind(id).run();
    if (result.meta.changes !== 1) return noStoreJson({ error: "This VAT settlement no longer exists.", errorCode: "VAT_SETTLEMENT_NOT_FOUND" }, { status: 404 });
    return noStoreJson({ id, deleted: true });
  } catch (error) {
    return trackerError(error, "Unable to delete the VAT settlement.");
  }
}
