"use server";

import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { buildWelcomeMessage } from "@/lib/whatsapp-welcome";

export interface WelcomeSendResult {
  ok: boolean;
  error?: string;
  /** true once actually delivered via the Meta WhatsApp API. */
  sentViaApi?: boolean;
  /** wa.me link with the message pre-filled — present when the branch has no
   *  WhatsApp API access, so the caller can open the sender's own WhatsApp
   *  and hit send manually instead. */
  waLink?: string;
}

export interface WelcomeTenantRow {
  id: string;
  full_name: string;
  phone: string | null;
  is_active: boolean;
  is_waiting: boolean;
  room_id: string | null;
  hostel_id: string;
}

interface BuiltWelcome {
  digits: string;
  message: string;
  hostelId: string;
  whatsappEnabled: boolean;
}

// Same host the request actually came in on (localhost:3000 in dev,
// hms.yourpulse.io in prod, any future custom domain) instead of a static
// env var — so links in the message always match the environment sending them.
async function getSiteOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("host");
  if (!host) return process.env.NEXT_PUBLIC_SITE_URL ?? "https://hms.yourpulse.io";
  const protocol = host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https";
  return `${protocol}://${host}`;
}

// Builds the welcome text and target phone from an already-fetched tenant row
// — shared by the auto-send, the API send, and the wa.me fallback below, so
// there's exactly one place that assembles the message. Doesn't decide how
// (or whether) to deliver it — callers do that based on whatsappEnabled.
// Hostel + room are independent lookups (CLAUDE.md perf rule #1) — fanned out
// together instead of chained.
async function buildWelcomeTextFromTenant(tenant: WelcomeTenantRow): Promise<{ ok: true; data: BuiltWelcome } | { ok: false; error: string }> {
  if (!tenant.is_active || tenant.is_waiting) {
    return { ok: false, error: "Tenant must be an active resident to receive a welcome message." };
  }

  const digits = (tenant.phone ?? "").replace(/\D/g, "").replace(/^0/, "92");
  if (!digits) return { ok: false, error: "This tenant has no phone number on file." };

  const admin = createAdminClient();
  const [{ data: hostel }, { data: room }, siteOrigin] = await Promise.all([
    admin
      .from("hms_hostels")
      .select("name, whatsapp_enabled, welcome_message_template, wifi_networks, listing_enabled, slug, meal_times")
      .eq("id", tenant.hostel_id)
      .single(),
    tenant.room_id
      ? admin.from("hms_rooms").select("room_number").eq("id", tenant.room_id).maybeSingle()
      : Promise.resolve({ data: null }),
    getSiteOrigin(),
  ]);
  if (!hostel) return { ok: false, error: "Hostel not found" };

  // Links straight to the Packages & Menu tab of THIS hostel specifically —
  // not just /find/{slug}. When the owner has more than one publicly-listed
  // branch, /find/{slug}/page.tsx detects that and shows a "choose your
  // branch" overview instead of the hostel itself (see
  // getPublicHostelsByOwner), which would silently swallow ?tab=menu. The
  // nested /find/{slug}/{slug} route (app/find/[slug]/[branchSlug]/page.tsx)
  // renders this exact hostel directly regardless of sibling branches, so
  // using it for both segments works whether the owner has one branch or many.
  const menuUrl = hostel.listing_enabled && hostel.slug ? `${siteOrigin}/find/${hostel.slug}/${hostel.slug}?tab=menu` : null;

  const message = buildWelcomeMessage({
    template: hostel.welcome_message_template,
    tenantName: tenant.full_name,
    hostelName: hostel.name,
    room: room?.room_number ?? null,
    wifiNetworks: hostel.wifi_networks ?? [],
    menuUrl,
    mealTimes: hostel.meal_times,
  });

  return { ok: true, data: { digits, message, hostelId: tenant.hostel_id, whatsappEnabled: !!hostel.whatsapp_enabled } };
}

async function buildWelcomeText(tenantId: string): Promise<{ ok: true; data: BuiltWelcome } | { ok: false; error: string }> {
  const admin = createAdminClient();
  const { data: tenant } = await admin
    .from("hms_tenants")
    .select("id, full_name, phone, is_active, is_waiting, room_id, hostel_id")
    .eq("id", tenantId)
    .single();
  if (!tenant) return { ok: false, error: "Tenant not found" };
  return buildWelcomeTextFromTenant(tenant);
}

// Fired once per tenant activation (brand-new active tenant, or an existing
// waiting-list tenant whose room finally gets assigned) — never a recurring
// job, so unlike the reminder/leaving-reminder engines there's no dedup
// column here. "Only call it once" is enforced by call-site placement (see
// the six sites in app/actions/tenants.ts, applications.ts, managers.ts,
// partner.ts, and components/modules/tenants/tenants-client.tsx). Never
// throws — every caller fires this without awaiting or handling errors, so a
// slow/failed WhatsApp send can never block or fail tenant creation.
//
// No wa.me fallback here: there's no browser present to open a link for an
// automatic background send. Branches without WhatsApp API access simply get
// no auto-send, same as before — they still have the manual "Resend Welcome"
// button below, which does fall back to wa.me.
export async function sendTenantWelcomeMessageAction(tenantId: string): Promise<void> {
  try {
    const built = await buildWelcomeText(tenantId);
    if (!built.ok) {
      console.error(`[whatsapp-welcome] Skipped auto welcome for tenant ${tenantId}: ${built.error}`);
      return;
    }
    if (!built.data.whatsappEnabled) return;

    const result = await sendWhatsAppMessage(built.data.digits, built.data.message, {
      hostelId: built.data.hostelId,
      tenantId,
      messageType: "welcome",
    });
    if (!result.ok) {
      console.error(`[whatsapp-welcome] Meta WhatsApp API rejected welcome message for tenant ${tenantId}:`, result.error);
    }
  } catch (err) {
    console.error(`[whatsapp-welcome] Failed to send welcome message for tenant ${tenantId}:`, err);
  }
}

// Owner/partner/manager-facing manual resend, called from the "Resend Welcome"
// button in tenants-client.tsx. Takes the already-fetched tenant row (the
// caller — resendTenantWelcomeMessageAction in app/actions/tenants.ts —
// already queried it for the ownership check) instead of a bare tenantId, so
// this doesn't re-fetch the same row a second time.
//
// Branches with WhatsApp API access get an automatic send, same as before.
// Branches WITHOUT it still get to use this feature — not gated behind a
// Meta-curated flag — by getting back a wa.me link with the exact same
// message pre-filled, which the caller opens to send from their own WhatsApp.
export async function sendWelcomeMessageNow(tenant: WelcomeTenantRow): Promise<WelcomeSendResult> {
  try {
    const built = await buildWelcomeTextFromTenant(tenant);
    if (!built.ok) return { ok: false, error: built.error };

    if (!built.data.whatsappEnabled) {
      const waLink = `https://wa.me/${built.data.digits}?text=${encodeURIComponent(built.data.message)}`;
      return { ok: true, sentViaApi: false, waLink };
    }

    const result = await sendWhatsAppMessage(built.data.digits, built.data.message, {
      hostelId: built.data.hostelId,
      tenantId: tenant.id,
      messageType: "welcome",
    });
    return { ok: result.ok, error: result.error, sentViaApi: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : "Failed to send welcome message";
    console.error(`[whatsapp-welcome] Manual resend failed for tenant ${tenant.id}:`, err);
    return { ok: false, error };
  }
}
