import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendWhatsAppTemplateMessage } from "@/lib/whatsapp";
import { TEMPLATES, noticeReceivedParams, lastDayReminderParams } from "@/lib/whatsapp-templates";
import { sendNoticeReceivedEmail, sendLastDayReminderEmail } from "@/lib/email";
import { formatDayLong } from "@/lib/utils";

interface NoticeTenant {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  is_active: boolean;
  intended_checkout_date: string | null;
  hostel_id: string;
  hostel: { name?: string; whatsapp_enabled?: boolean } | { name?: string; whatsapp_enabled?: boolean }[] | null;
}

async function loadNoticeTenant(tenantId: string): Promise<NoticeTenant | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("hms_tenants")
    .select("id, full_name, phone, email, is_active, intended_checkout_date, hostel_id, hostel:hms_hostels(name, whatsapp_enabled)")
    .eq("id", tenantId)
    .maybeSingle();
  return (data as NoticeTenant | null) ?? null;
}

function digits(phone: string | null | undefined): string {
  return (phone ?? "").replace(/\D/g, "").replace(/^0/, "92");
}

/**
 * Sent when a resident's notice to leave is recorded (giveTenantNoticeAction):
 * confirms the notice and states their last day, on WhatsApp (approved template,
 * gated on the branch's whatsapp_enabled) and email (whenever an address is on
 * file). Fire-and-forget — callers `void` it; never throws.
 */
export async function sendNoticeReceivedToTenant(tenantId: string): Promise<void> {
  try {
    const t = await loadNoticeTenant(tenantId);
    if (!t || !t.is_active || !t.intended_checkout_date) return;
    const hostel = Array.isArray(t.hostel) ? t.hostel[0] : t.hostel;
    const lastDay = formatDayLong(t.intended_checkout_date);

    const email = (t.email ?? "").trim();
    if (email) {
      try {
        await sendNoticeReceivedEmail({ tenantEmail: email, tenantName: t.full_name, hostelName: hostel?.name ?? "your hostel", lastDay });
      } catch (err) { console.error(`[notice] email failed for tenant ${tenantId}:`, err); }
    }

    const to = digits(t.phone);
    if (!hostel?.whatsapp_enabled || to.length < 11) return;
    const res = await sendWhatsAppTemplateMessage(
      to,
      TEMPLATES.noticeReceived.name,
      TEMPLATES.noticeReceived.language,
      noticeReceivedParams({ tenantName: t.full_name, hostelName: hostel?.name, checkoutDate: t.intended_checkout_date }),
      { hostelId: t.hostel_id, tenantId, messageType: "leaving_reminder" },
    );
    if (!res.ok) console.error(`[notice] Meta rejected notice-received for tenant ${tenantId}:`, res.error);
  } catch (err) {
    console.error("[notice] unexpected failure:", err);
  }
}

/**
 * Sent on the resident's last day (the leaving-reminders cron): complete
 * checkout, clear dues, and note that staying on adds charges per policy. Same
 * WhatsApp + email channels and gating as above. Never throws.
 */
export async function sendLastDayReminderToTenant(tenantId: string): Promise<void> {
  try {
    const t = await loadNoticeTenant(tenantId);
    if (!t || !t.is_active) return;
    const hostel = Array.isArray(t.hostel) ? t.hostel[0] : t.hostel;
    const lastDay = t.intended_checkout_date ? formatDayLong(t.intended_checkout_date) : "today";

    const email = (t.email ?? "").trim();
    if (email) {
      try {
        await sendLastDayReminderEmail({ tenantEmail: email, tenantName: t.full_name, hostelName: hostel?.name ?? "your hostel", lastDay });
      } catch (err) { console.error(`[last-day] email failed for tenant ${tenantId}:`, err); }
    }

    const to = digits(t.phone);
    if (!hostel?.whatsapp_enabled || to.length < 11) return;
    const res = await sendWhatsAppTemplateMessage(
      to,
      TEMPLATES.lastDayReminder.name,
      TEMPLATES.lastDayReminder.language,
      lastDayReminderParams({ tenantName: t.full_name, hostelName: hostel?.name }),
      { hostelId: t.hostel_id, tenantId, messageType: "leaving_reminder" },
    );
    if (!res.ok) console.error(`[last-day] Meta rejected last-day reminder for tenant ${tenantId}:`, res.error);
  } catch (err) {
    console.error("[last-day] unexpected failure:", err);
  }
}
