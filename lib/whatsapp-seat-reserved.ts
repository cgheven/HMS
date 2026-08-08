import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendWhatsAppTemplateMessage } from "@/lib/whatsapp";
import { TEMPLATES, seatReservedParams } from "@/lib/whatsapp-templates";
import { sendSeatReservedEmail } from "@/lib/email";
import { formatDayLong } from "@/lib/utils";

/**
 * Sends hms_seat_reserved once, when a reservation deposit is actually taken
 * from a waiting-list tenant.
 *
 * ONE TIME by construction, with no extra bookkeeping: the only caller,
 * recordReservationDepositAction, throws if hms_tenants.deposit_collected_on
 * is already set. It therefore cannot reach its success path twice for the
 * same tenant, so this cannot fire twice either. Adding a "message sent" flag
 * would be a second source of truth that could drift from the first.
 *
 * Gated on hms_hostels.whatsapp_enabled, like every other automated send.
 * Fire-and-forget: the deposit is already banked by the time this runs, and a
 * Meta outage must never roll back money that was taken.
 */
export async function sendSeatReservedConfirmation(tenantId: string): Promise<void> {
  try {
    const admin = createAdminClient();

    const { data: tenant } = await admin
      .from("hms_tenants")
      .select(
        "id, full_name, phone, email, check_in, deposit_collected_amount, hostel_id, hostel:hms_hostels(name, whatsapp_enabled)"
      )
      .eq("id", tenantId)
      .maybeSingle();
    if (!tenant) return;

    const hostel = Array.isArray(tenant.hostel) ? tenant.hostel[0] : tenant.hostel;

    // The message states "we have received Rs X". Only what was genuinely
    // collected justifies that sentence — the agreed security_deposit figure
    // is a promise, not a receipt, and is set for 7 of 9 waiting tenants whose
    // money was never recorded. Checked before either channel.
    const collected = Number(tenant.deposit_collected_amount ?? 0);
    if (collected <= 0) return;

    const digits = (tenant.phone ?? "").replace(/\D/g, "").replace(/^0/, "92");
    const canWhatsApp = !!hostel?.whatsapp_enabled && digits.length >= 11;
    const tenantEmail = ((tenant as { email?: string | null }).email ?? "").trim();

    // Email is NOT gated on whatsapp_enabled. That switch is off for 15 of 16
    // branches, so putting the email behind it would have made this look built
    // while never sending anything.
    if (tenantEmail) {
      try {
        await sendSeatReservedEmail({
          tenantEmail,
          tenantName: tenant.full_name,
          hostelName: hostel?.name ?? "your hostel",
          depositCollected: collected,
          expectedJoining: tenant.check_in ? formatDayLong(tenant.check_in as string) : null,
        });
      } catch (err) {
        console.error(`[seat-reserved] deposit email failed for tenant ${tenantId}:`, err);
      }
    }

    if (!canWhatsApp) return;

    const result = await sendWhatsAppTemplateMessage(
      digits,
      TEMPLATES.seatReserved.name,
      TEMPLATES.seatReserved.language,
      seatReservedParams({
        tenantName: tenant.full_name,
        depositCollected: collected,
        hostelName: hostel?.name,
        expectedJoining: tenant.check_in,
      }),
      { hostelId: tenant.hostel_id as string, tenantId, messageType: "receipt" }
    );

    if (!result.ok) {
      console.error(`[seat-reserved] Meta rejected confirmation for tenant ${tenantId}:`, result.error);
    }
  } catch (err) {
    console.error("[seat-reserved] unexpected failure:", err);
  }
}
