import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface UndoResult {
  undone?: {
    amount: number;
    forMonth: string;
    tenantName: string | null;
    paymentDate: string;
    installmentId: string;
    paymentMethod: string | null;
    receiptNumber: string | null;
    restoredAmountPaid: number;
  };
  error?: string;
}

/**
 * Reverses the MOST RECENT installment on a bill, restoring it exactly.
 *
 * Every installment row stores amount_before — the running total collected
 * before that transaction — so an undo is a restore, not a recalculation.
 * Nothing is derived and nothing can drift.
 *
 * Only the latest installment can be undone. 30 bills in production carry more
 * than one (up to four), and reversing an arbitrary middle one would mean
 * recomputing every installment after it. Undoing twice fixes two mistakes; the
 * rule stays one sentence.
 *
 * The installment row is deleted rather than flagged, so no migration is needed
 * and stage and production stay schema-identical. The audit trail lives in
 * hms_activity_log, which the caller writes — losing that would make this a way
 * to erase money quietly, which is the opposite of the point.
 */
export async function performPaymentUndo(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  paymentId: string,
  hostelId: string
): Promise<UndoResult> {
  // One call, one transaction. Everything — the guards, the restore and the
  // installment delete — happens inside hms_undo_last_payment (migration 209),
  // so a failure part-way cannot leave the bill disagreeing with its own
  // payment history. The previous two-round-trip version could, and reported
  // success while doing it.
  const { data, error } = await admin.rpc("hms_undo_last_payment", {
    p_payment_id: paymentId,
    p_hostel_id: hostelId,
  });

  if (error) {
    // The function raises with a message written for the operator, so it is
    // shown as-is. Anything else is unexpected and gets a generic line.
    const msg = error.message ?? "";
    const known =
      msg.includes("not found in this branch") ||
      msg.includes("booking deposit") ||
      msg.includes("written off") ||
      msg.includes("no recorded payment") ||
      msg.includes("outside its payment history");
    if (!known) console.error("[payment-undo] rpc failed:", error);
    return { error: known ? msg : "Could not undo this payment. Reopen the page and try again." };
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { error: "Could not undo this payment. Reopen the page and try again." };

  return {
    undone: {
      amount: Number(row.amount ?? 0),
      forMonth: (row.for_month as string) ?? "",
      tenantName: (row.tenant_name as string) ?? null,
      paymentDate: (row.payment_date as string) ?? "",
      installmentId: (row.installment_id as string) ?? "",
      paymentMethod: (row.payment_method as string) ?? null,
      receiptNumber: (row.receipt_number as string) ?? null,
      restoredAmountPaid: Number(row.restored_paid ?? 0),
    },
  };
}
