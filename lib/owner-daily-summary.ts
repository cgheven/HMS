import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendWhatsAppTemplateMessage } from "@/lib/whatsapp";
import { TEMPLATES, ownerDailySummaryParams } from "@/lib/whatsapp-templates";
import { sendOwnerDailySummaryEmail } from "@/lib/email";

/** One branch's day, computed once and read by both channels. */
export interface BranchDayFigures {
  hostelId: string;
  hostelName: string;
  ownerId: string;
  ownerName: string | null;
  ownerPhone: string | null;
  whatsappEnabled: boolean;
  branchWhatsapp: string | null;
  branchPhone: string | null;
  collection: number;
  kitchen: number;
  staff: number;
  bills: number;
  other: number;
  /** Evaluated ONCE here so both channels skip exactly the same branches. */
  hasActivity: boolean;
}

export interface DailySummaryResult {
  branches: number;
  sent: number;
  skipped: number;
  failed: number;
  reasons: Record<string, number>;
}

/**
 * Computes one day's figures for EVERY branch, whatever channel will carry them.
 *
 * Figures come from the same four expense sources the Reports page totals
 * (hms_expenses, hms_kitchen_expenses, hms_salary_payments, hms_bills) and the
 * same collection basis (amount_paid on payments settled that day). If these
 * ever disagree with Reports, the owner stops trusting both.
 *
 * Previously this ran only for whatsapp_enabled branches, which is why 11 of 15
 * got no summary at all. Widening the set cannot change any existing branch's
 * numbers: every total is accumulated into a Map keyed strictly on hostel_id and
 * read back per branch, with no cross-branch aggregation, no ordering dependency
 * and no LIMIT.
 */
export async function computeDailyFigures(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  /** ISO date (PKT calendar day) the figures cover. */
  date: string
): Promise<BranchDayFigures[]> {
  const { data: hostels, error } = await admin
    .from("hms_hostels")
    .select("id, name, owner_id, whatsapp_enabled, phone, whatsapp");
  if (error) throw error;

  const all = hostels ?? [];
  if (all.length === 0) return [];

  const ownerIds = [...new Set(all.map((h) => h.owner_id))];
  const ids = all.map((h) => h.id);

  const [{ data: owners }, { data: payments }, { data: expenses }, { data: kitchen }, { data: salaries }, { data: advancesToday }, { data: bills }] =
    await Promise.all([
      admin.from("hms_profiles").select("id, full_name, phone, email").in("id", ownerIds),
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
        .select("hostel_id, amount, advance_deducted")
        .in("hostel_id", ids)
        .eq("payment_date", date)
        .eq("status", "paid"),
      // This summary is the day's cash, so an advance handed over today counts
      // here even though it is a loan rather than a staff cost.
      admin
        .from("hms_salary_advances")
        .select("hostel_id, amount")
        .in("hostel_id", ids)
        .eq("advance_date", date),
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
  // NET of any advance held back, plus advances given today. Gross would count
  // the deducted rupees twice — once when the advance left, once inside a salary
  // that never fully went out.
  const salTotal = sumBy(salaries, (e) => Number(e.amount ?? 0) - Number(e.advance_deducted ?? 0));
  const advTotal = sumBy(advancesToday, (a) => Number(a.amount ?? 0));
  for (const [hostelId, amt] of advTotal) {
    salTotal.set(hostelId, (salTotal.get(hostelId) ?? 0) + amt);
  }
  const billTotal = sumBy(bills, (e) => Number(e.amount ?? 0));

  return all.map((h) => {
    const owner = ownerById.get(h.owner_id);
    const collection = collected.get(h.id) ?? 0;
    const kitchenAmt = kitTotal.get(h.id) ?? 0;
    const staffAmt = salTotal.get(h.id) ?? 0;
    const billsAmt = billTotal.get(h.id) ?? 0;
    const otherAmt = expTotal.get(h.id) ?? 0;

    return {
      hostelId: h.id as string,
      hostelName: h.name as string,
      ownerId: h.owner_id as string,
      ownerName: (owner?.full_name as string | null) ?? null,
      ownerPhone: (owner?.phone as string | null) ?? null,
      whatsappEnabled: !!h.whatsapp_enabled,
      branchWhatsapp: (h.whatsapp as string | null) ?? null,
      branchPhone: (h.phone as string | null) ?? null,
      collection,
      kitchen: kitchenAmt,
      staff: staffAmt,
      bills: billsAmt,
      other: otherAmt,
      // A branch with no money in and none out has nothing worth a message; a
      // daily "all zeros" is how a useful notification becomes one people mute.
      hasActivity:
        collection !== 0 || kitchenAmt !== 0 || staffAmt !== 0 || billsAmt !== 0 || otherAmt !== 0,
    };
  });
}

/**
 * One WhatsApp summary per branch, to the OWNER.
 *
 * Sends to hms_profiles.phone — the owner's own number — falling back to the
 * branch's own numbers. NEVER promote that fallback to the email channel: a
 * full-tier partner can edit a branch's phone from the browser, so a daily
 * profit figure would follow whichever handset they nominated.
 */
export async function sendOwnerDailySummaries(
  branches: BranchDayFigures[],
  date: string
): Promise<DailySummaryResult> {
  const result: DailySummaryResult = { branches: 0, sent: 0, skipped: 0, failed: 0, reasons: {} };
  const skip = (why: string) => {
    result.skipped++;
    result.reasons[why] = (result.reasons[why] ?? 0) + 1;
  };

  // THE WHATSAPP GATE. Per-branch, super-admin granted. Email is deliberately
  // NOT gated on this — see sendOwnerDailySummaryEmails below. Do not move this
  // filter into computeDailyFigures: that would silently re-narrow the email
  // channel to the 4 branches that have WhatsApp.
  const granted = branches.filter((b) => b.whatsappEnabled);
  result.branches = granted.length;
  if (granted.length === 0) return result;

  for (const b of granted) {
    // Profile first, then THIS branch's own numbers — the same chain
    // sendInvoiceWhatsApp already uses. Reading only the profile meant a client
    // whose number is recorded on their branches but not their profile was
    // skipped every single day, silently: Chohan Executive has 03049190319 on
    // both branches and never received a summary, while the invoice reminders
    // to the same client went through fine.
    const raw = b.ownerPhone || b.branchWhatsapp || b.branchPhone || "";
    const digits = raw.replace(/\D/g, "").replace(/^0/, "92");
    if (digits.length < 11) {
      skip("no phone on the owner profile or the branch");
      continue;
    }

    if (!b.hasActivity) {
      skip("no activity");
      continue;
    }

    const res = await sendWhatsAppTemplateMessage(
      digits,
      TEMPLATES.ownerDailySummary.name,
      TEMPLATES.ownerDailySummary.language,
      ownerDailySummaryParams({
        ownerName: b.ownerName,
        branchName: b.hostelName,
        date,
        collection: b.collection,
        kitchen: b.kitchen,
        staff: b.staff,
        bills: b.bills,
        other: b.other,
      }),
      { hostelId: b.hostelId, tenantId: null, ownerId: b.ownerId, messageType: "announcement" }
    );

    if (res.ok) result.sent++;
    else {
      result.failed++;
      console.error(`[owner-daily-summary] Meta rejected summary for branch ${b.hostelName}:`, res.error);
    }
  }

  return result;
}

/**
 * The same summary by EMAIL, one per branch, for ALL branches.
 *
 * Not gated on whatsapp_enabled: 11 of 15 branches have never had WhatsApp
 * granted and got no summary at all before this. One email per branch rather
 * than one per owner, so a client on both channels sees the same message twice
 * instead of two differently-shaped reports.
 *
 * Sequential, never Promise.all — Resend's default rate limit is ~2 req/s and a
 * burst 429s silently.
 */
export async function sendOwnerDailySummaryEmails(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  branches: BranchDayFigures[],
  date: string
): Promise<DailySummaryResult> {
  const result: DailySummaryResult = { branches: branches.length, sent: 0, skipped: 0, failed: 0, reasons: {} };
  const skip = (why: string) => {
    result.skipped++;
    result.reasons[why] = (result.reasons[why] ?? 0) + 1;
  };

  const ownerIds = [...new Set(branches.map((b) => b.ownerId))];
  if (ownerIds.length === 0) return result;

  // Resolved STRICTLY from the owner's own records. Never hms_hostels.email or
  // .phone: migration 094 lets a full-tier partner UPDATE hms_hostels from the
  // browser, so a hostel-level fallback would let them redirect the P&L of a
  // branch they part-own to themselves.
  const { data: profiles } = await admin.from("hms_profiles").select("id, email").in("id", ownerIds);
  const emailByOwner = new Map<string, string>();
  for (const p of profiles ?? []) {
    const e = ((p.email as string | null) ?? "").trim();
    if (e) emailByOwner.set(p.id as string, e);
  }
  for (const id of ownerIds) {
    if (emailByOwner.has(id)) continue;
    try {
      const {
        data: { user },
      } = await admin.auth.admin.getUserById(id);
      if (user?.email) emailByOwner.set(id, user.email);
    } catch {
      // Falls through to "no owner email" below.
    }
  }

  // Resend's default is ~2 requests/second. Sequential sending bounds
  // concurrency, not RATE — at 200-400ms per call a straight loop runs at
  // 2.5-5/s and starts collecting 429s, which sendOrThrow turns into counted
  // failures that nothing retries. Pace it explicitly.
  const RESEND_MIN_GAP_MS = 600;
  let first = true;

  for (const b of branches) {
    if (!b.hasActivity) {
      skip("no activity");
      continue;
    }
    const to = emailByOwner.get(b.ownerId);
    // Managers hold synthetic @hms-portal.internal accounts that receive no
    // mail; an owner should never have one, but never send to one either.
    if (!to || to.endsWith("@hms-portal.internal")) {
      skip("no owner email");
      continue;
    }

    if (!first) await new Promise((r) => setTimeout(r, RESEND_MIN_GAP_MS));
    first = false;

    try {
      await sendOwnerDailySummaryEmail({
        ownerEmail: to,
        ownerName: b.ownerName,
        branchName: b.hostelName,
        date,
        collection: b.collection,
        kitchen: b.kitchen,
        staff: b.staff,
        bills: b.bills,
        other: b.other,
      });
      result.sent++;
    } catch (err) {
      result.failed++;
      console.error(`[owner-daily-summary] email failed for branch ${b.hostelName}:`, err);
    }
  }

  return result;
}
