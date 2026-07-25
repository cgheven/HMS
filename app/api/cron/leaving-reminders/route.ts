import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runLeavingReminderPass, type LeavingReminderSummary } from "@/lib/leaving-reminder-engine";

export const maxDuration = 300;

// Invoked daily by Vercel Cron (see vercel.json). Same CRON_SECRET auth as the
// other cron routes. Sends a one-shot WhatsApp reminder to the OWNER (not the
// tenant) 7 days before a tenant's intended_checkout_date, via the same
// Meta WhatsApp Business API — prepare the room, arrange the
// deposit refund. Same whatsapp_enabled gate (migration 110) as payment
// reminders and announcements. The actual scan/send logic lives in
// lib/leaving-reminder-engine.ts.

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  const { data: grantedHostels } = await admin
    .from("hms_hostels")
    .select("id")
    .eq("whatsapp_enabled", true);

  const hostelIds = (grantedHostels ?? []).map((h) => h.id);

  // Isolated per hostel — one branch's DB error shouldn't block every other
  // granted branch's reminders from going out.
  const results = await Promise.all(
    hostelIds.map(async (id): Promise<LeavingReminderSummary & { error?: string }> => {
      try {
        return await runLeavingReminderPass(admin, id);
      } catch (err) {
        console.error(`[leaving-reminders] hostel ${id} failed:`, err instanceof Error ? err.message : err);
        return { checked: 0, sent: 0, skipped: 0, failed: 0, error: err instanceof Error ? err.message : String(err) };
      }
    })
  );

  const total = results.reduce(
    (acc, r) => ({
      checked: acc.checked + r.checked,
      sent: acc.sent + r.sent,
      skipped: acc.skipped + r.skipped,
      failed: acc.failed + r.failed,
    }),
    { checked: 0, sent: 0, skipped: 0, failed: 0 }
  );

  const hostelErrors = results.filter((r) => r.error).map((r) => r.error);

  return NextResponse.json({ ...total, hostelsProcessed: hostelIds.length, ...(hostelErrors.length > 0 ? { hostelErrors } : {}) });
}
