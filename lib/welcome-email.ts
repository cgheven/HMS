import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendWelcomeEmail } from "@/lib/email";
import { wifiNetworksForResident } from "@/lib/wifi-coverage";
import { prepareReferralEmailSection, markReferralInviteSent } from "@/lib/whatsapp-referral-invite";
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
 * has them configured. If NEITHER WiFi (for this room) NOR the mess is configured,
 * nothing is sent at all — this email exists to carry WiFi + mess info.
 */
export async function sendWelcomeEmailToTenant(tenantId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: tenant } = await admin
      .from("hms_tenants")
      .select(
        "id, full_name, email, is_active, is_waiting, hostel_id, room:hms_rooms(room_number, floor), hostel:hms_hostels(name, wifi_networks, meal_times, listing_enabled, slug, complaint_code, whatsapp_enabled)"
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

    // "Mess configured" = the branch actually has something to serve: real menu
    // items (hms_food_items) or configured meal times. A public-listing link to an
    // empty menu tab does NOT count as configured.
    const meals = mealTimeLines(hostel.meal_times as MealTimes | null);
    const { count: menuItemCount } = await admin
      .from("hms_food_items")
      .select("id", { count: "exact", head: true })
      .eq("hostel_id", tenant.hostel_id as string);
    const hasMenu = (menuItemCount ?? 0) > 0;
    const messConfigured = hasMenu || meals.length > 0;

    // The complaint form is per-branch and every branch has a code, so it always
    // rides this email — the resident can raise a complaint without asking for a link.
    const complaintCode = (hostel as { complaint_code?: string | null }).complaint_code ?? null;
    const complaintUrl = complaintCode ? `${siteUrl()}/complaint/${complaintCode}` : null;

    // Referral offer — folded into THIS one email instead of a separate send, but
    // only for WhatsApp-off (self-registered) branches: WhatsApp branches get the
    // referral over WhatsApp (ensureAndSendReferralInvite). Prepared without
    // stamping link_sent_at; we stamp it below only after this email actually sends.
    const whatsappOn = !!(hostel as { whatsapp_enabled?: boolean }).whatsapp_enabled;
    const referral = whatsappOn
      ? null
      : await prepareReferralEmailSection(admin, tenant.hostel_id as string, tenant.id as string);

    // Nothing at all to say — no WiFi for this room, no mess, no complaint code and
    // no referral — so send NOTHING. In practice the complaint link is always
    // present, so this only guards a truly unconfigured branch.
    if (wifi.length === 0 && !messConfigured && !complaintUrl && !referral) return;

    // Link to the public menu only when there IS a menu to see (and the branch is
    // publicly listed with a slug). Built from the env site URL (this may run with
    // no request present, e.g. a background/after send).
    const menuUrl =
      hasMenu && hostel.listing_enabled && hostel.slug
        ? `${siteUrl()}/find/${hostel.slug}/${hostel.slug}?tab=menu`
        : null;

    await sendWelcomeEmail({
      tenantEmail: email,
      tenantName: tenant.full_name as string,
      hostelName: hostel.name as string,
      room: (room?.room_number as string) ?? null,
      wifi,
      menuUrl,
      mealTimeLines: meals,
      complaintUrl,
      referral: referral
        ? {
            link: referral.link,
            referrerPct: referral.referrerPct,
            referredPct: referral.referredPct,
            statusUrl: referral.statusUrl,
          }
        : null,
    });

    // Only now that the email has actually been sent: stamp the referral as
    // invited, so the campaign and WhatsApp never re-invite this resident.
    if (referral) await markReferralInviteSent(admin, referral.codeId);
  } catch (err) {
    console.error(`[welcome-email] failed for tenant ${tenantId}:`, err);
  }
}
