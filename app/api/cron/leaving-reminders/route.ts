import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runLeavingReminderPass, runLastDayReminderPass, type LeavingReminderSummary } from "@/lib/leaving-reminder-engine";

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

  // The OWNER's 7-days-out reminder is WhatsApp-only, so it runs for
  // whatsapp_enabled branches. The RESIDENT's last-day reminder also sends email,
  // so it runs for EVERY branch.
  const [{ data: grantedHostels }, { data: allHostels }] = await Promise.all([
    admin.from("hms_hostels").select("id").eq("whatsapp_enabled", true),
    admin.from("hms_hostels").select("id"),
  ]);
  const grantedIds = new Set((grantedHostels ?? []).map((h) => h.id));
  const hostelIds = (allHostels ?? []).map((h) => h.id);

  // Isolated per hostel — one branch's DB error shouldn't block the others.
  const results = await Promise.all(
    hostelIds.map(async (id): Promise<LeavingReminderSummary & { error?: string }> => {
      try {
        const lastDay = await runLastDayReminderPass(admin, id);
        const owner = grantedIds.has(id)
          ? await runLeavingReminderPass(admin, id)
          : { checked: 0, sent: 0, skipped: 0, failed: 0 };
        return {
          checked: lastDay.checked + owner.checked,
          sent: lastDay.sent + owner.sent,
          skipped: lastDay.skipped + owner.skipped,
          failed: lastDay.failed + owner.failed,
        };
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
