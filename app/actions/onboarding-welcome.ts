"use server";
import { unstable_rethrow } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOwnerOrAbove } from "@/lib/auth";
import { getAuthContext } from "@/lib/data";
import type { WifiNetwork, MealTimes } from "@/types";

export interface WelcomeStep {
  key: "details" | "charges" | "paymethods" | "billing" | "wifi" | "meals" | "menu" | "referral" | "website" | "rooms" | "tenant" | "payment";
  done: boolean;
  required: boolean;
}

export interface WelcomeStatus {
  steps: WelcomeStep[];
  doneCount: number;
  total: number;
  /** Every REQUIRED step is done — the account is usable. Drives the dashboard
   *  resume card (shown only while a required step is still open). */
  requiredDone: boolean;
  /** Every required step the owner completes INLINE on the welcome page
   *  (property details, charges, payment methods) is done. The other required
   *  steps (rooms -> tenant -> payment) are completed on their OWN pages, so
   *  they can never be a condition for holding someone on /welcome — they would
   *  have to leave it to satisfy them. This is the first-login navigation gate. */
  setupDone: boolean;
  /** Every step (required + recommended) is done. */
  allDone: boolean;
}

function chargesConfigured(cfg: Record<string, unknown> | null): boolean {
  if (!cfg) return false;
  const numericKeys = [
    "security_deposit", "ac_per_unit_rate", "ac_maintenance_rate", "registration_fee",
    "washroom_premium", "food_monthly_rate", "food_breakfast_rate", "food_lunch_rate",
    "food_dinner_rate", "food_all_meals_rate",
  ];
  if (numericKeys.some((k) => Number(cfg[k] ?? 0) > 0)) return true;
  // seater_prices / package_prices: { key: { no_ac, ac, deposit_no_ac, deposit_ac } }
  const nested = [cfg.seater_prices, cfg.package_prices];
  return nested.some((obj) =>
    Object.values((obj ?? {}) as Record<string, unknown>).some((row) =>
      row && typeof row === "object" && Object.values(row as Record<string, unknown>).some((v) => Number(v ?? 0) > 0)
    )
  );
}

function mealsConfigured(meals: MealTimes | null | undefined): boolean {
  if (!meals) return false;
  return (["breakfast", "lunch", "dinner"] as const).some((m) => {
    const r = meals[m];
    return !!(r?.from?.trim() && r?.to?.trim());
  });
}

/**
 * Live setup progress for the ACTIVE branch. Every step's `done` is DERIVED from
 * real data (rooms priced, wifi set, ...), never a stored flag — so the checklist
 * ticks can never drift from reality. Read-only; owner/partner read guard.
 *
 * Active-branch scope is correct for the target audience (a brand-new self-reg
 * owner has exactly one branch); a returning multi-branch owner sees the status
 * of whichever branch is active, which is the intended per-branch reading.
 */
export async function getWelcomeStatus(): Promise<WelcomeStatus> {
  await requireOwnerOrAbove();
  const ctx = await getAuthContext();
  const hostel = (ctx?.hostel ?? null) as unknown as Record<string, unknown> | null;
  const hostelId = ctx?.hostelId;

  let roomCount = 0;
  let menuCount = 0;
  let tenantCount = 0;
  let paidCount = 0;
  let charges: Record<string, unknown> | null = null;

  if (hostelId) {
    const supabase = ctx!.supabase;
    const [rooms, menu, tenants, paid, cfg] = await Promise.all([
      // Existence, not rent: per-resident rent lives on hms_tenants (captured at
      // admission), NOT on the room — real hostels run with hms_rooms.monthly_rent
      // at 0 — so "has rooms" is the correct signal for this step.
      supabase.from("hms_rooms").select("id", { count: "exact", head: true }).eq("hostel_id", hostelId),
      supabase.from("hms_food_items").select("id", { count: "exact", head: true }).eq("hostel_id", hostelId),
      supabase.from("hms_tenants").select("id", { count: "exact", head: true }).eq("hostel_id", hostelId),
      // "Recorded a payment" = money actually collected on a bill, not merely a
      // bill existing (bills auto-generate). amount_paid > 0 is that signal.
      supabase.from("hms_payments").select("id", { count: "exact", head: true }).eq("hostel_id", hostelId).gt("amount_paid", 0),
      supabase.from("hms_package_configs").select("*").eq("hostel_id", hostelId).maybeSingle(),
    ]);
    roomCount = rooms.count ?? 0;
    menuCount = menu.count ?? 0;
    tenantCount = tenants.count ?? 0;
    paidCount = paid.count ?? 0;
    charges = (cfg.data as Record<string, unknown> | null) ?? null;
  }

  // Branded subdomain is account-level (hms_profiles.subdomain), not per-branch —
  // "done" once the owner has claimed their {label}.hostels.yourpulse.io address.
  const subdomainClaimed = Boolean((ctx?.profile as { subdomain?: string | null } | null)?.subdomain);

  const wifi = (hostel?.wifi_networks ?? []) as WifiNetwork[];
  const payMethods = (hostel?.payment_methods ?? []) as unknown[];
  const referrerPct = Number(hostel?.referral_referrer_percent ?? 0);
  const referredPct = Number(hostel?.referral_referred_percent ?? 0);
  // "Property details" is done once they've filled anything beyond the auto-set
  // name — an address/city/phone, or picked who can live here.
  const detailsDone = ["address", "city", "phone", "hostel_type"].some(
    (k) => String((hostel?.[k] ?? "")).trim() !== ""
  );

  // Config first (set the property up), then the real product cycle last
  // (rooms → tenant → payment) — those redirect to the live pages so the owner
  // learns the workflow, and each ticks off its real data once done.
  // Required = essentials that appear on receipts/invoices/reminders or are the
  // core cycle (rooms → tenant → payment). Optional = enhancements (WiFi, meals,
  // menu, referral, website). The dashboard resume card shows until every required
  // step is done.
  // Optional: a fixed billing day for the whole branch. "Done" once set; leaving
  // it off (per-tenant join-date billing, the default) is a perfectly valid
  // choice, so it never blocks completion (required: false).
  const billingDaySet = (hostel?.billing_anchor_day ?? null) !== null;

  const steps: WelcomeStep[] = [
    { key: "details",    required: true,  done: detailsDone },
    { key: "charges",    required: true,  done: chargesConfigured(charges) },
    { key: "paymethods", required: true,  done: payMethods.length > 0 },
    { key: "billing",    required: false, done: billingDaySet },
    { key: "wifi",       required: false, done: wifi.length > 0 },
    { key: "meals",      required: false, done: mealsConfigured(hostel?.meal_times as MealTimes | null) },
    { key: "menu",       required: false, done: menuCount > 0 },
    { key: "referral",   required: false, done: referrerPct >= 1 && referredPct >= 1 },
    { key: "website",    required: false, done: subdomainClaimed },
    { key: "rooms",      required: true,  done: roomCount > 0 },
    { key: "tenant",     required: true,  done: tenantCount > 0 },
    { key: "payment",    required: true,  done: paidCount > 0 },
  ];

  // The inline-config required steps — the ones with a form ON the welcome page.
  // Deliberately excludes rooms/tenant/payment, which link out to their own pages.
  const GATING_KEYS: WelcomeStep["key"][] = ["details", "charges", "paymethods"];

  return {
    steps,
    doneCount: steps.filter((s) => s.done).length,
    total: steps.length,
    requiredDone: steps.filter((s) => s.required).every((s) => s.done),
    setupDone: steps.filter((s) => GATING_KEYS.includes(s.key)).every((s) => s.done),
    allDone: steps.every((s) => s.done),
  };
}

/**
 * Mark the welcome flow finished/skipped for the current owner. After this the
 * dashboard never force-redirects them to /welcome again. Session-scoped: writes
 * only the caller's own profile row (RLS "Users update own profile" + explicit
 * id filter), so it can never touch another account.
 */
export async function dismissWelcome(): Promise<{ success: boolean; error?: string }> {
  try {
    // Admin client, not the session client: dismissing the welcome is a
    // self-scoped UI preference, but the session-scoped freeze trigger
    // (hms_block_frozen, migration 229) blocks ALL hms_profiles writes for a
    // frozen account — which would trap a frozen owner on /welcome forever (Skip
    // fails → the dashboard redirect re-fires). Still fully scoped: .eq("id",
    // profile.id) where profile comes from requireOwnerOrAbove(), so it can only
    // ever touch the caller's own row.
    const profile = await requireOwnerOrAbove();
    const admin = createAdminClient();
    const { error } = await admin
      .from("hms_profiles")
      .update({ onboarding_dismissed_at: new Date().toISOString() })
      .eq("id", profile.id);
    if (error) throw error;
    return { success: true };
  } catch (err) {
    unstable_rethrow(err);
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
