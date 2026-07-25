"use server";

import { unstable_rethrow } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOwnerOrPartnerTier } from "@/lib/auth";
import { getAuthContext } from "@/lib/data";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { processInBatches } from "@/lib/batch";

const SEND_CONCURRENCY = 5;

async function resolveHostelId(): Promise<string> {
  const ctx = await getAuthContext();
  if (!ctx?.hostelId) throw new Error("Unauthorized: no active hostel");
  return ctx.hostelId;
}

export interface AnnouncementSendSummary {
  checked: number;
  sent: number;
  skipped: number;
  failed: number;
}

// Reuses the same Meta WhatsApp Business API service and the same
// Super-Admin-curated whatsapp_enabled gate as the payment-reminder engine
// (lib/whatsapp.ts, migration 110) — WhatsApp is granted per branch as one
// package covering
// both reminders and announcements, not two separate flags. Manual trigger
// only — no scheduling, no WhatsApp group support — the owner reviews the
// announcement, then explicitly sends it to every active tenant's own
// number one at a time.
export async function sendAnnouncementToWhatsAppAction(
  announcementId: string
): Promise<{ data?: AnnouncementSendSummary; error?: string }> {
  try {
    await requireOwnerOrPartnerTier("standard");
    const hostelId = await resolveHostelId();
    const admin = createAdminClient();

    const { data: hostel } = await admin
      .from("hms_hostels")
      .select("name, whatsapp_enabled")
      .eq("id", hostelId)
      .single();
    if (!hostel?.whatsapp_enabled) {
      throw new Error("WhatsApp isn't enabled for this branch yet. Contact support to have this feature turned on.");
    }

    const { data: announcement } = await admin
      .from("hms_announcements")
      .select("id, title, content")
      .eq("id", announcementId)
      .eq("hostel_id", hostelId)
      .single();
    if (!announcement) throw new Error("Announcement not found");

    // Atomically claim the send before dispatching anything — without this,
    // a double-click, a second browser tab, or a retried request can race
    // past the client's disabled-button check and broadcast to every tenant
    // twice. Only the request that flips whatsapp_sent_at from null wins.
    const { data: claimed } = await admin
      .from("hms_announcements")
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq("id", announcementId)
      .is("whatsapp_sent_at", null)
      .select("id");
    if (!claimed || claimed.length === 0) {
      throw new Error("This announcement has already been sent to WhatsApp.");
    }

    const { data: tenants } = await admin
      .from("hms_tenants")
      .select("id, full_name, phone")
      .eq("hostel_id", hostelId)
      .eq("is_active", true)
      .eq("is_waiting", false);

    const checked = tenants?.length ?? 0;
    const due = (tenants ?? []).filter((t) => (t.phone ?? "").replace(/\D/g, "").length >= 10);

    const message = `📢 *${announcement.title}*\n\n${announcement.content}\n\n— ${hostel.name}`;

    let sent = 0;
    let failed = 0;

    await processInBatches(due, SEND_CONCURRENCY, async (t) => {
      const digits = (t.phone ?? "").replace(/\D/g, "").replace(/^0/, "92");
      const result = await sendWhatsAppMessage(digits, message, { hostelId, tenantId: t.id, messageType: "announcement" });
      if (!result.ok) {
        failed++;
        console.error(`[announcements] Meta WhatsApp API rejected announcement for "${t.full_name}" (${digits}):`, result.error);
        return;
      }
      sent++;
    });

    await admin
      .from("hms_announcements")
      .update({ whatsapp_sent_count: sent })
      .eq("id", announcementId);

    return { data: { checked, sent, skipped: checked - due.length, failed } };
  } catch (err: unknown) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
