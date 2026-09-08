import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendWhatsAppTemplateMessage } from "@/lib/whatsapp";
import { TEMPLATES, admissionConfirmationParams } from "@/lib/whatsapp-templates";

/**
 * Sends hms_admission_confirmation_emergency_contact to a newly-admitted resident's EMERGENCY
 * CONTACT (a parent/guardian), once, when the resident is activated.
 *
 * Fired from the same tenant-activation call sites as the welcome message, so
 * it is one-time by the same construction — a resident is activated once. There
 * is no dedup column, matching the welcome/seat-reserved sends; adding one would
 * be a second source of truth that could drift.
 *
 * Gated on hms_hostels.whatsapp_enabled like every other automated send, and
 * skipped silently unless the tenant is an active (non-waiting) resident with an
 * emergency phone on file. Never throws: every caller fires this without
 * awaiting, so a Meta outage can never block or fail admission.
 */
export async function sendAdmissionConfirmationToEmergencyContact(tenantId: string): Promise<void> {
  try {
    const admin = createAdminClient();

    const { data: tenant } = await admin
      .from("hms_tenants")
      .select(
        "id, full_name, is_active, is_waiting, check_in, emergency_contact, emergency_phone, hostel_id, room:hms_rooms(room_number), hostel:hms_hostels(name, whatsapp_enabled, phone, whatsapp)"
      )
      .eq("id", tenantId)
      .maybeSingle();
    if (!tenant) return;

    // Only a genuine, moved-in resident triggers a confirmation to their family.
    // A waiting-list entry has not been admitted yet.
    if (!tenant.is_active || tenant.is_waiting) return;

    const hostel = Array.isArray(tenant.hostel) ? tenant.hostel[0] : tenant.hostel;
    const room = Array.isArray(tenant.room) ? tenant.room[0] : tenant.room;
    // The hostel's own line for the family to call — its general number, falling
    // back to its WhatsApp number when no general number is on file.
    const hostelContact = (hostel?.phone ?? "").trim() || (hostel?.whatsapp ?? "").trim();

    const digits = (tenant.emergency_phone ?? "").replace(/\D/g, "").replace(/^0/, "92");
    // No emergency phone → nothing to send. This is the common reason to skip,
    // not an error: the field is optional on the intake form.
    if (digits.length < 11) return;
    if (!hostel?.whatsapp_enabled) return;

    const result = await sendWhatsAppTemplateMessage(
      digits,
      TEMPLATES.admissionConfirmation.name,
      TEMPLATES.admissionConfirmation.language,
      admissionConfirmationParams({
        emergencyContactName: tenant.emergency_contact,
        residentName: tenant.full_name,
        hostelName: hostel?.name,
        admissionDate: tenant.check_in as string | null,
        roomNumber: room?.room_number ?? null,
        hostelPhone: hostelContact || null,
      }),
      { hostelId: tenant.hostel_id as string, tenantId, messageType: "welcome" }
    );

    if (!result.ok) {
      console.error(`[admission-confirmation] Meta rejected confirmation for tenant ${tenantId}:`, result.error);
    }
  } catch (err) {
    console.error("[admission-confirmation] unexpected failure:", err);
  }
}
