import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { pktTodayDateString } from "@/lib/pkt-time";
import { buildLeavingReminderMessage } from "@/lib/whatsapp-leaving-reminder";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { processInBatches } from "@/lib/batch";

const SEND_CONCURRENCY = 5;
const NOTICE_WINDOW_DAYS = 7;

export interface LeavingReminderPassRow {
  id: string;
  full_name: string;
  room_id: string | null;
  intended_checkout_date: string | null;
  hostel: { name: string; whatsapp: string | null; phone: string | null; whatsapp_enabled: boolean } | null;
}

export interface LeavingReminderSummary {
  checked: number;
  sent: number;
  skipped: number;
  failed: number;
}

// One-shot reminder to the OWNER (not the tenant) 7 days before a tenant's
// notice-period checkout date — prepare the room, arrange the deposit
// refund. Shared by the daily cron (app/api/cron/leaving-reminders/route.ts).
// Unlike the recurring payment-reminder cadence, this fires on an exact-date
// match — there's only one "7 days out" moment per notice, guarded by
// leaving_reminder_sent_at rather than a re-checked schedule.
export async function runLeavingReminderPass(admin: SupabaseClient, hostelId: string): Promise<LeavingReminderSummary> {
  const targetDate = pktTodayDateString(new Date(Date.now() + NOTICE_WINDOW_DAYS * 86400000));

  const { data: tenants, error } = await admin
    .from("hms_tenants")
    .select(
      "id, full_name, room_id, intended_checkout_date, " +
      "hostel:hms_hostels(name, whatsapp, phone, whatsapp_enabled)"
    )
    .eq("hostel_id", hostelId)
    .eq("is_active", true)
    .eq("intended_checkout_date", targetDate)
    .is("leaving_reminder_sent_at", null)
    .returns<LeavingReminderPassRow[]>();

  if (error) throw new Error(error.message);

  const due: LeavingReminderPassRow[] = [];
  let skipped = 0;

  for (const t of tenants ?? []) {
    if (!t.hostel?.whatsapp_enabled) {
      skipped++;
      continue;
    }
    const digits = ((t.hostel?.whatsapp ?? t.hostel?.phone) ?? "").replace(/\D/g, "");
    if (digits.length < 10) {
      skipped++;
      continue;
    }
    due.push(t);
  }

  let sent = 0;
  let failed = 0;

  await processInBatches(due, SEND_CONCURRENCY, async (t) => {
    // Atomic claim BEFORE sending — mirrors the double-send-race guard already
    // applied to app/actions/announcements.ts. Only the caller that flips
    // leaving_reminder_sent_at from null wins; a concurrent/duplicate cron
    // invocation gets zero rows back and skips.
    const { data: claimed } = await admin
      .from("hms_tenants")
      .update({ leaving_reminder_sent_at: new Date().toISOString() })
      .eq("id", t.id)
      .is("leaving_reminder_sent_at", null)
      .select("id");
    if (!claimed || claimed.length === 0) {
      skipped++;
      return;
    }

    const { data: room } = t.room_id
      ? await admin.from("hms_rooms").select("room_number").eq("id", t.room_id).maybeSingle()
      : { data: null };

    const digits = ((t.hostel?.whatsapp ?? t.hostel?.phone) ?? "").replace(/\D/g, "").replace(/^0/, "92");
    const message = buildLeavingReminderMessage({
      tenantName: t.full_name,
      room: room?.room_number ?? null,
      checkoutDate: t.intended_checkout_date!,
      hostelName: t.hostel?.name ?? "",
    });

    const result = await sendWhatsAppMessage(digits, message, { hostelId, tenantId: t.id, messageType: "leaving_reminder" });
    if (!result.ok) {
      failed++;
      console.error(`[leaving-reminder-engine] Meta WhatsApp API rejected reminder for tenant ${t.id}:`, result.error);
      return;
    }
    sent++;
  });

  return { checked: tenants?.length ?? 0, sent, skipped, failed };
}
