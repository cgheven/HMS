import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendWelcomeEmail } from "@/lib/email";
import { wifiNetworksForResident } from "@/lib/wifi-coverage";
import { siteUrl } from "@/lib/site-url";
import type { WifiNetwork, MealTimes } from "@/types";

/** Plain "Breakfast: 7:00 AM - 9:00 AM" lines, only for meals a branch actually
 *  serves (both ends of the range filled in). */
function mealTimeLines(meal: MealTimes | null | undefined): string[] {
  const rows: [string, { from?: string; to?: string } | undefined][] = [
    ["Breakfast", meal?.breakfast],
    ["Lunch", meal?.lunch],
    ["Dinner", meal?.dinner],
  ];
  return rows
    .filter(([, r]) => r?.from?.trim() && r?.to?.trim())
    .map(([label, r]) => `${label}: ${r!.from!.trim()} - ${r!.to!.trim()}`);
}

/**
 * Emails the resident their welcome (WiFi + menu) on admission.
 *
 * Fired from the same tenant-activation call sites as the WhatsApp sends, so it
 * is one-time by construction. Never throws — callers fire it without awaiting,
 * so a mail outage can never block or fail admission. NOT gated on
 * whatsapp_enabled (this is email); it needs only an email address on file, and
 * skips silently otherwise.
 *
 * Only the WiFi networks that reach the resident's room are listed
 * (lib/wifi-coverage.ts); the menu/meal-times blocks appear only when the branch
 * has them configured.
 */
export async function sendWelcomeEmailToTenant(tenantId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: tenant } = await admin
      .from("hms_tenants")
      .select(
        "id, full_name, email, is_active, is_waiting, hostel_id, room:hms_rooms(room_number, floor), hostel:hms_hostels(name, wifi_networks, meal_times, listing_enabled, slug)"
      )
      .eq("id", tenantId)
      .maybeSingle();
    if (!tenant) return;
    // Only a genuine moved-in resident gets a welcome — a waiting-list row hasn't
    // been admitted yet.
    if (!tenant.is_active || tenant.is_waiting) return;

    const email = ((tenant.email as string) ?? "").trim();
    if (!email) return; // no address on file — nothing to send

    const hostel = Array.isArray(tenant.hostel) ? tenant.hostel[0] : tenant.hostel;
    const room = Array.isArray(tenant.room) ? tenant.room[0] : tenant.room;
    if (!hostel) return;

    const networks = (hostel.wifi_networks ?? []) as WifiNetwork[];
    const wifi = wifiNetworksForResident(networks, {
      roomNumber: (room?.room_number as string) ?? null,
      floor: (room?.floor as number) ?? null,
    }).map((n) => ({ name: n.name, password: n.password ?? null }));

    // Same public menu link the welcome WhatsApp uses — only when the branch is
    // publicly listed with a slug. Built from the env site URL (this may run with
    // no request present, e.g. a background/after send).
    const menuUrl =
      hostel.listing_enabled && hostel.slug
        ? `${siteUrl()}/find/${hostel.slug}/${hostel.slug}?tab=menu`
        : null;

    await sendWelcomeEmail({
      tenantEmail: email,
      tenantName: tenant.full_name as string,
      hostelName: hostel.name as string,
      room: (room?.room_number as string) ?? null,
      wifi,
      menuUrl,
      mealTimeLines: mealTimeLines(hostel.meal_times as MealTimes | null),
    });
  } catch (err) {
    console.error(`[welcome-email] failed for tenant ${tenantId}:`, err);
  }
}
