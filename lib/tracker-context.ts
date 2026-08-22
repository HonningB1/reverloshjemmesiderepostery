import type { TransactionContext } from "../app/track/types";

// transaction_context was introduced after the original B2B checkbox. A
// legacy is_b2b=1 is therefore an explicit classification, but only when no
// newer context has been stored. Everything else defaults safely to PRIVATE.
export function effectiveTransactionContext(
  transactionContext: TransactionContext | string | null | undefined,
  isB2b?: boolean | number | null,
): TransactionContext {
  if (transactionContext === "B2B") return "B2B";
  if (transactionContext === "SPECIAL") return "SPECIAL";
  if ((transactionContext === null || transactionContext === undefined) && (isB2b === true || isB2b === 1)) return "B2B";
  return "PRIVATE";
}

// Keep D1 reads aligned with the runtime resolver. Arguments must be trusted
// SQL column expressions from the calling query, never user input.
export function effectiveTransactionContextSql(transactionContextColumn: string, isB2bColumn?: string) {
  const legacyB2b = isB2bColumn
    ? ` OR (${transactionContextColumn} IS NULL AND COALESCE(${isB2bColumn}, 0) = 1)`
    : "";
  return `CASE WHEN ${transactionContextColumn} = 'B2B'${legacyB2b} THEN 'B2B' WHEN ${transactionContextColumn} = 'SPECIAL' THEN 'SPECIAL' ELSE 'PRIVATE' END`;
}
