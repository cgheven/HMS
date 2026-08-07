import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendWhatsAppTemplateMessage } from "@/lib/whatsapp";
import { TEMPLATES, ownerDailySummaryParams } from "@/lib/whatsapp-templates";

export interface DailySummaryResult {
  branches: number;
  sent: number;
  skipped: number;
  failed: number;
  reasons: Record<string, number>;
}

/**
 * One WhatsApp summary per branch, to the OWNER, for a single day.
 *
 * Figures come from the same four expense sources the Reports page totals
 * (hms_expenses, hms_kitchen_expenses, hms_salary_payments, hms_bills) and the
 * same collection basis (amount_paid on payments settled that day). If these
 * ever disagree with Reports, the owner stops trusting both.
 *
 * Sends to hms_profiles.phone — the owner's own number — and NEVER falls back
 * to the hostel's public number. That fallback exists elsewhere for invoice
 * sharing, but a daily profit figure landing on a number a manager answers
 * would hand staff the owner's finances.
 */
export async function sendOwnerDailySummaries(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  /** ISO date (PKT calendar day) the figures cover. */
  date: string
): Promise<DailySummaryResult> {
  const result: DailySummaryResult = { branches: 0, sent: 0, skipped: 0, failed: 0, reasons: {} };
  const skip = (why: string) => {
    result.skipped++;
    result.reasons[why] = (result.reasons[why] ?? 0) + 1;
  };

  const { data: hostels, error } = await admin
    .from("hms_hostels")
    .select("id, name, owner_id, whatsapp_enabled");
  if (error) throw error;

  const granted = (hostels ?? []).filter((h) => h.whatsapp_enabled);
  result.branches = granted.length;
  if (granted.length === 0) return result;

  const ownerIds = [...new Set(granted.map((h) => h.owner_id))];
  const ids = granted.map((h) => h.id);

  const [{ data: owners }, { data: payments }, { data: expenses }, { data: kitchen }, { data: salaries }, { data: bills }] =
    await Promise.all([
      admin.from("hms_profiles").select("id, full_name, phone").in("id", ownerIds),
      admin
        .from("hms_payments")
        .select("hostel_id, amount, amount_paid")
        .in("hostel_id", ids)
        .eq("payment_date", date)
        .in("status", ["paid", "partially_paid"]),
      admin.from("hms_expenses").select("hostel_id, amount").in("hostel_id", ids).eq("date", date),
      admin.from("hms_kitchen_expenses").select("hostel_id, amount").in("hostel_id", ids).eq("date", date),
      admin
        .from("hms_salary_payments")
        .select("hostel_id, amount")
        .in("hostel_id", ids)
        .eq("payment_date", date)
        .eq("status", "paid"),
      admin.from("hms_bills").select("hostel_id, amount").in("hostel_id", ids).eq("paid_date", date),
    ]);

  const ownerById = new Map((owners ?? []).map((o) => [o.id as string, o]));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sumBy = (rows: any[] | null, pick: (r: any) => number) => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) m.set(r.hostel_id, (m.get(r.hostel_id) ?? 0) + pick(r));
    return m;
  };

  // amount_paid where present, mirroring reports.ts — `amount` is the bill, not
  // what came in, and a partially paid row would otherwise be counted in full.
  const collected = sumBy(payments, (p) => Number(p.amount_paid ?? p.amount ?? 0));
  const expTotal = sumBy(expenses, (e) => Number(e.amount ?? 0));
  const kitTotal = sumBy(kitchen, (e) => Number(e.amount ?? 0));
  const salTotal = sumBy(salaries, (e) => Number(e.amount ?? 0));
  const billTotal = sumBy(bills, (e) => Number(e.amount ?? 0));

  for (const h of granted) {
    const owner = ownerById.get(h.owner_id);
    const digits = (owner?.phone ?? "").replace(/\D/g, "").replace(/^0/, "92");
    if (digits.length < 11) {
      skip("owner has no phone");
      continue;
    }

    const collection = collected.get(h.id) ?? 0;
    const kitchenAmt = kitTotal.get(h.id) ?? 0;
    const staffAmt = salTotal.get(h.id) ?? 0;
    const billsAmt = billTotal.get(h.id) ?? 0;
    const otherAmt = expTotal.get(h.id) ?? 0;

    // A branch with no money in and none out has nothing worth a message; a
    // daily "all zeros" is how a useful notification becomes one people mute.
    if (collection === 0 && kitchenAmt === 0 && staffAmt === 0 && billsAmt === 0 && otherAmt === 0) {
      skip("no activity");
      continue;
    }

    const res = await sendWhatsAppTemplateMessage(
      digits,
      TEMPLATES.ownerDailySummary.name,
      TEMPLATES.ownerDailySummary.language,
      ownerDailySummaryParams({
        ownerName: owner?.full_name,
        branchName: h.name,
        date,
        collection,
        kitchen: kitchenAmt,
        staff: staffAmt,
        bills: billsAmt,
        other: otherAmt,
      }),
      { hostelId: h.id as string, tenantId: null, messageType: "announcement" }
    );

    if (res.ok) result.sent++;
    else {
      result.failed++;
      console.error(`[owner-daily-summary] Meta rejected summary for branch ${h.name}:`, res.error);
    }
  }

  return result;
}
