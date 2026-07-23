import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { pktTodayDateString } from "@/lib/pkt-time";
import { ensureMonthlyPaymentRows } from "@/lib/monthly-payment-sync";
import { runReminderPass, type ReminderSummary } from "@/lib/reminder-engine";

// Vercel default (10s Hobby / 60s Pro) isn't enough once more branches are
// granted and a day's due-tenant count grows — request the platform's max;
// harmless if the plan caps it lower than this.
export const maxDuration = 300;

// Invoked daily by Vercel Cron (see vercel.json). Same CRON_SECRET auth as the
// other cron routes. Auto-sends a WhatsApp reminder — via the single shared
// Wasender platform session — to any tenant still pending/overdue/partially
// paid for the current month, on THEIR OWN due day (the day-of-month they
// checked in) — not a single fixed day for the whole hostel, since tenants in
// the same branch can each have joined on a different date. If still unpaid
// past that day, it repeats every 3 days (due day, +3, +6, ...) instead of
// waiting a full month for the next anniversary. A tenant who has checked out
// (is_active = false) is never reminded, even if a balance is still
// outstanding. This is a curated feature, not self-service: none of this runs
// for a branch unless Super Admin has explicitly granted it
// (hms_hostels.auto_reminder_enabled — pinned against owner self-grant by a
// DB trigger, migration 106). The actual scan/send logic lives in
// lib/reminder-engine.ts, shared with the owner-facing manual "Send Reminders
// Now" button (sendBulkRemindersAction).

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const forMonth = pktTodayDateString().slice(0, 7);
  const admin = createAdminClient();

  const { data: grantedHostels } = await admin
    .from("hms_hostels")
    .select("id")
    .eq("auto_reminder_enabled", true);

  const hostelIds = (grantedHostels ?? []).map((h) => h.id);

  // A tenant's rent row for this month only exists once someone opens Monthly
  // View for it — guarantee it exists for every granted branch (only those;
  // every other branch is left exactly as before) so the scan below never
  // silently finds nothing just because no one has visited the Payments page
  // yet this month.
  await Promise.all(hostelIds.map((id) => ensureMonthlyPaymentRows(admin, id, forMonth)));

  // Isolated per hostel — one branch's DB error shouldn't block every other
  // granted branch's reminders from going out.
  const results = await Promise.all(
    hostelIds.map(async (id): Promise<ReminderSummary & { error?: string }> => {
      try {
        return await runReminderPass(admin, id, forMonth, true);
      } catch (err) {
        console.error(`[payment-reminders] hostel ${id} failed:`, err instanceof Error ? err.message : err);
        return { checked: 0, sent: 0, skipped: 0, failed: 0, markFailed: 0, error: err instanceof Error ? err.message : String(err) };
      }
    })
  );

  const total = results.reduce(
    (acc, r) => ({
      checked: acc.checked + r.checked,
      sent: acc.sent + r.sent,
      skipped: acc.skipped + r.skipped,
      failed: acc.failed + r.failed,
      markFailed: acc.markFailed + r.markFailed,
    }),
    { checked: 0, sent: 0, skipped: 0, failed: 0, markFailed: 0 }
  );

  const hostelErrors = results.filter((r) => r.error).map((r) => r.error);

  return NextResponse.json({ ...total, hostelsProcessed: hostelIds.length, ...(hostelErrors.length > 0 ? { hostelErrors } : {}) });
}
