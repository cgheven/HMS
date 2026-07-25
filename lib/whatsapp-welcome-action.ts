"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { buildWelcomeMessage } from "@/lib/whatsapp-welcome";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://hms.yourpulse.io";

// Fired once per tenant activation (brand-new active tenant, or an existing
// waiting-list tenant whose room finally gets assigned) — never a recurring
// job, so unlike the reminder/leaving-reminder engines there's no dedup
// column here. "Only call it once" is enforced by call-site placement (see
// the six sites in app/actions/tenants.ts, applications.ts, managers.ts,
// partner.ts, and components/modules/tenants/tenants-client.tsx). Never
// throws — every caller fires this without awaiting or handling errors, so a
// slow/failed WhatsApp send can never block or fail tenant creation.
export async function sendTenantWelcomeMessageAction(tenantId: string): Promise<void> {
  try {
    const admin = createAdminClient();

    const { data: tenant } = await admin
      .from("hms_tenants")
      .select("full_name, phone, is_active, is_waiting, room_id, hostel_id")
      .eq("id", tenantId)
      .single();
    if (!tenant || !tenant.is_active || tenant.is_waiting) return;

    const { data: hostel } = await admin
      .from("hms_hostels")
      .select("name, whatsapp_enabled, welcome_message_template, wifi_networks, listing_enabled, slug, meal_times")
      .eq("id", tenant.hostel_id)
      .single();
    if (!hostel?.whatsapp_enabled) return;

    const digits = (tenant.phone ?? "").replace(/\D/g, "").replace(/^0/, "92");
    if (!digits) return;

    const room = tenant.room_id
      ? (await admin.from("hms_rooms").select("room_number").eq("id", tenant.room_id).maybeSingle()).data
      : null;

    const menuUrl = hostel.listing_enabled && hostel.slug ? `${SITE_URL}/find/${hostel.slug}` : null;

    const message = buildWelcomeMessage({
      template: hostel.welcome_message_template,
      tenantName: tenant.full_name,
      hostelName: hostel.name,
      room: room?.room_number ?? null,
      wifiNetworks: hostel.wifi_networks ?? [],
      menuUrl,
      mealTimes: hostel.meal_times,
    });

    const result = await sendWhatsAppMessage(digits, message, { hostelId: tenant.hostel_id, tenantId, messageType: "welcome" });
    if (!result.ok) {
      console.error(`[whatsapp-welcome] Meta WhatsApp API rejected welcome message for tenant ${tenantId}:`, result.error);
    }
  } catch (err) {
    console.error(`[whatsapp-welcome] Failed to send welcome message for tenant ${tenantId}:`, err);
  }
}
