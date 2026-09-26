import "server-only";

/** Any client with service-role rights — the only role granted EXECUTE on the RPC. */
type Rpc = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };

/**
 * The next branded receipt number, PULSE-YYYYMM-NNNNN (migration 273).
 *
 * The counter lives in a Postgres sequence, so it is safe under concurrent
 * collection and can never hand the same number to two payments — unlike the
 * browser-side `HMS-<month>-<initials>-<3 random digits>` it replaces, which had
 * 900 possible values and no uniqueness check at all.
 *
 * Returns null if the number could not be issued. Deliberate: money being
 * collected must never fail because a label could not be minted. `receipt_number`
 * is nullable and the public receipt route mints one on first view, so a null
 * here is repaired the moment anyone looks at the receipt.
 */
export async function nextReceiptNumber(db: Rpc, month: string): Promise<string | null> {
  try {
    const { data, error } = await db.rpc("hms_next_receipt_number", { p_month: month ?? "" });
    if (error || typeof data !== "string" || !data) return null;
    return data;
  } catch {
    return null;
  }
}

/** Shared cap for an operator-typed receipt number. The column is `text`; the two
 *  collection paths previously capped at 120 and 64, so the same input could be
 *  stored differently depending on who collected. */
export const RECEIPT_NUMBER_MAX = 64;
