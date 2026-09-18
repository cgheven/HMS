"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOwnerWrite, requireNotFrozen } from "@/lib/auth";
import { isKnownCountry, DEFAULT_COUNTRY, isManualBankBilling } from "@/lib/country-config";
import { MAX_PROPERTIES, ACCOMMODATION_TYPE_VALUES } from "@/lib/validation";
import { chargeTierUpgradeForOwner, previewTierUpgradeForOwner, type TierSyncResult } from "@/lib/tier-sync";
import { tierForPropertyCount, type PricingTier } from "@/lib/tier-pricing";
import { asPlan } from "@/lib/entitlements";
import type { Hostel } from "@/types";

// Setup/config fields copied when "copy from existing property" is chosen. Identity
// (name/slug), location + contact (address/city/area/phone/whatsapp/email), account-
// level billing/referral, and per-property branding/wifi are NOT copied — and
// residents/payments are never touched. Just "how this property runs".
// NB: whatsapp_enabled is deliberately NOT here — it is a manual-only Super Admin
// grant (never plan-driven), not an owner setting, so a new property starts off
// and must be enabled on exclusive request, never inheriting it from another property.
const COPYABLE_HOSTEL_FIELDS = [
  "form_config", "amenities", "meal_times", "food_menu_type",
  "food_closed_on_sundays", "payment_methods", "reminder_template",
  "welcome_message_template", "meter_all_rooms",
] as const;

// Package-config columns copied to a new property (or seeded to zero). A missing
// config row makes the payment trigger write NULL and hides tenants on the Monthly
// View, so every new property must have one.
const PACKAGE_CONFIG_COLUMNS =
  "food_monthly_rate, ac_per_unit_rate, food_bd_rate, food_3meals_rate, package_prices, security_deposit, food_breakfast_rate, food_lunch_rate, food_dinner_rate, food_all_meals_rate, seater_prices, notice_period_days, washroom_premium, registration_fee, ac_maintenance_rate, ac_charge_label";

async function seedDefaultPackageConfig(
  admin: ReturnType<typeof createAdminClient>,
  hostelId: string
): Promise<void> {
  const { error } = await admin.from("hms_package_configs").upsert(
    {
      hostel_id: hostelId,
      ac_per_unit_rate: 0, ac_maintenance_rate: 0, security_deposit: 0,
      notice_period_days: 30, food_monthly_rate: 0, food_breakfast_rate: 0,
      food_lunch_rate: 0, food_dinner_rate: 0, food_all_meals_rate: 0, seater_prices: {},
    },
    { onConflict: "hostel_id", ignoreDuplicates: true }
  );
  if (error) console.error("[createBranch] default config seed failed:", error.message);
}

const COOKIE_NAME = "hms_active_hostel";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

// Staleness window for the per-owner billing lock — sized well above the realistic
// worst case of the critical section (a few sequential Paddle round-trips: a
// price read, a subscription read, and the proration charge) so a live holder's
// lease does not expire mid-flight and get stolen. Also caps how long an owner
// waits to retry if a request dies without releasing (rare). The fencing token,
// not this timeout, is the actual correctness guarantee.
const LOCK_STALE_MS = 120_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getAuthedUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) throw new Error("Unauthorized");
  return { supabase, user };
}

// ---------------------------------------------------------------------------
// getOwnedHostels
// ---------------------------------------------------------------------------

export async function getOwnedHostels(): Promise<{
  hostels: (Hostel & { is_primary: boolean })[];
  error?: string;
}> {
  try {
    const { supabase, user } = await getAuthedUser();

    // Try hms_owner_hostels junction first; fall back to legacy owner_id column
    const { data: junctionRows, error: jErr } = await supabase
      .from("hms_owner_hostels")
      .select("hostel_id, is_primary")
      .eq("owner_id", user.id);

    if (jErr || !junctionRows || junctionRows.length === 0) {
      // Legacy fallback — hostels with direct owner_id
      const { data: legacyHostels, error: legacyErr } = await supabase
        .from("hms_hostels")
        .select("*")
        .eq("owner_id", user.id)
        .order("created_at");

      if (legacyErr) return { hostels: [], error: legacyErr.message };

      const hostels = ((legacyHostels ?? []) as Hostel[]).map((h, idx) => ({
        ...h,
        is_primary: idx === 0,
      }));
      return { hostels };
    }

    const hostelIds = junctionRows.map((r) => r.hostel_id);
    const primaryMap = Object.fromEntries(
      junctionRows.map((r) => [r.hostel_id, r.is_primary])
    );

    const { data: hostels, error: hErr } = await supabase
      .from("hms_hostels")
      .select("*")
      .in("id", hostelIds)
      .order("created_at");

    if (hErr) return { hostels: [], error: hErr.message };

    return {
      hostels: ((hostels ?? []) as Hostel[]).map((h) => ({
        ...h,
        is_primary: primaryMap[h.id] ?? false,
      })),
    };
  } catch (e) {
    return { hostels: [], error: (e as Error).message };
  }
}

// ---------------------------------------------------------------------------
// switchActiveHostel
// ---------------------------------------------------------------------------

export async function switchActiveHostel(
  hostelId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await getAuthedUser(); // validates session — throws if unauthenticated

    // Ownership check removed — getAuthContext validates the cookie against owned
    // hostels on every request and falls back to the primary hostel for invalid IDs,
    // so setting an unowned ID here gains nothing and the check added 2 DB queries.
    const cookieStore = await cookies();
    cookieStore.set(COOKIE_NAME, hostelId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: COOKIE_MAX_AGE,
      sameSite: "lax",
    });

    // router.refresh() in the client handles cache invalidation — revalidatePath is redundant here
    return { success: true };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

// ---------------------------------------------------------------------------
// renameBranch
// ---------------------------------------------------------------------------

export async function renameBranch(data: {
  hostelId: string;
  name: string;
  city?: string;
  address?: string;
}): Promise<{ error?: string }> {
  try {
    if (!data.name?.trim()) return { error: "Branch name cannot be empty." };
    const { supabase, user } = await getAuthedUser();

    // Verify ownership
    const { data: owned } = await supabase
      .from("hms_owner_hostels")
      .select("hostel_id")
      .eq("owner_id", user.id)
      .eq("hostel_id", data.hostelId)
      .maybeSingle();

    if (!owned) return { error: "You do not own this branch." };
    await requireNotFrozen(user.id);

    const { error } = await supabase
      .from("hms_hostels")
      .update({
        name: data.name.trim(),
        city: data.city?.trim() || null,
        address: data.address?.trim() || null,
      })
      .eq("id", data.hostelId);

    if (error) throw error;
    revalidatePath("/");
    return {};
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// ---------------------------------------------------------------------------
// createBranch
// ---------------------------------------------------------------------------

export async function createBranch(data: {
  name: string;
  address?: string;
  city?: string;
  area?: string;
  phone?: string;
  whatsapp?: string;
  email?: string;
  total_capacity?: number;
  country?: string;
  property_type?: string;
  hostel_type?: string; // "who can live here" — boys | girls | mixed
  // Optional: copy the setup (rates, food, form config, amenities…) from one of
  // the owner's existing properties, so a new property is usable immediately.
  copyFromHostelId?: string;
}): Promise<{ hostel?: Hostel; error?: string; billing?: TierSyncResult; firstProperty?: boolean }> {
  const admin = createAdminClient();
  let ownerId: string | null = null;
  // Fencing token: proves THIS request is the lock holder. Release/re-check are
  // gated on it, so a superseded request can never clobber the current holder's
  // lock. null until the lock is actually acquired.
  let lockToken: string | null = null;
  try {
    if (!data.name?.trim()) return { error: "Property name is required." };

    // Creating a property is an ACCOUNT-level action, not a branch-level one, so
    // it stays owner-only even for a full-tier partner. This guard is the only
    // thing stopping it: the underlying "Owner manages own hostel" RLS policy
    // is `auth.uid() = owner_id`, which any authenticated user satisfies for a
    // row they insert with their own id — so every logged-in user (partner,
    // manager, sales rep) could previously call this action directly and mint
    // a hostel they owned outright, regardless of what the sidebar showed.
    await requireOwnerWrite();

    const { supabase, user } = await getAuthedUser();
    ownerId = user.id;

    // --- Per-owner serialization lock (compare-and-swap, fencing token) --------
    // Everything that decides the tier and charges for it must run one-at-a-time
    // per owner. Without this, two parallel "Add property" calls each read the
    // same billable count, each decide the same (too-low) tier, and both create —
    // landing the owner at a higher property count than they paid for (a TOCTOU
    // race). The CAS below only succeeds if the lock is free or older than the
    // staleness window (which auto-releases a crashed request so an owner is never
    // permanently wedged out). Uses the service-role client so RLS can't hide a
    // concurrent holder's row.
    //
    // LOCK_STALE_MS is sized generously above the realistic worst case of the
    // critical section (a few Paddle round-trips) so a live holder's lease does not
    // expire mid-flight and get stolen. The fencing token is the real guarantee: we
    // re-verify we still hold it immediately before the irreversible INSERT, and we
    // release only our own lock — so even if the window were somehow exceeded, a
    // preempted request neither creates nor clobbers the successor's lock.
    const token = crypto.randomUUID();
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const staleIso = new Date(nowMs - LOCK_STALE_MS).toISOString();
    const { data: lockRow } = await admin
      .from("hms_profiles")
      .update({ billing_lock_at: nowIso, billing_lock_token: token })
      .eq("id", user.id)
      .or(`billing_lock_at.is.null,billing_lock_at.lt.${staleIso}`)
      .select("id")
      .maybeSingle();
    if (!lockRow) {
      return { error: "A property change is already in progress. Please wait a moment and try again." };
    }
    lockToken = token;

    // Cap: an owner may hold at most MAX_PROPERTIES. Counted authoritatively
    // (service role) inside the lock so a concurrent add can't slip past it.
    const { count } = await admin
      .from("hms_hostels")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", user.id);
    if ((count ?? 0) >= MAX_PROPERTIES) {
      return { error: `You've reached the maximum of ${MAX_PROPERTIES} properties.` };
    }

    // Owner's billing profile — drives the tier system gates below.
    const { data: prof } = await admin
      .from("hms_profiles")
      .select("country, custom_unit_amount_usd, plan")
      .eq("id", user.id)
      .maybeSingle();
    const p = prof as { country?: string | null; custom_unit_amount_usd?: number | null; plan?: string | null } | null;
    const ownerCountry = p?.country ?? null;
    const hasCustomRate = p?.custom_unit_amount_usd != null && Number(p.custom_unit_amount_usd) > 0;
    const onTierSystem = !isManualBankBilling(ownerCountry) && !hasCustomRate;
    const fromTier: PricingTier = asPlan(p?.plan) ?? "basic";

    // Target tier from the authoritative billable count (+1 for the property we're
    // about to add — it is billing_active by default, so it counts immediately).
    const { count: billableCount } = await admin
      .from("hms_hostels")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", user.id)
      .eq("billing_active", true);
    const toTier: PricingTier = tierForPropertyCount((billableCount ?? 0) + 1);

    // Enterprise gate: a self-serve (Paddle) owner cannot cross INTO the Enterprise
    // tier (11+ billable properties) on their own — Enterprise is custom-quoted, so
    // adding the property that would put them there is blocked until sales sets up a
    // contract. PK/manual and grandfathered custom-rate owners never tier, so exempt.
    if (onTierSystem && toTier === "enterprise") {
      return {
        error:
          "You've reached our Business tier limit (10 properties). Enterprise plans are custom-quoted — please contact hello@yourpulse.io to add more.",
      };
    }

    // Build the insert payload NOW, before the charge — none of it depends on the
    // charge, and preparing it here means nothing sits between the post-charge
    // lock re-assertion and the INSERT (keeping that window as tight as possible).
    // Country: any real ISO country code (PK/GB explicit, everything else
    // synthesized), else fall back to the default (PK). Never trust an arbitrary
    // client value into the country-driven config.
    const country = isKnownCountry(data.country)
      ? (data.country as string).toUpperCase()
      : DEFAULT_COUNTRY;

    // Optionally read the setup fields from an existing property the owner owns.
    let copySource: Record<string, unknown> | null = null;
    if (data.copyFromHostelId) {
      const { data: src } = await supabase
        .from("hms_hostels")
        .select(COPYABLE_HOSTEL_FIELDS.join(", "))
        .eq("id", data.copyFromHostelId)
        .eq("owner_id", user.id)
        .maybeSingle();
      copySource = (src as Record<string, unknown> | null) ?? null;
    }

    const insertRow: Record<string, unknown> = {
      owner_id: user.id,
      name: data.name.trim(),
      address: data.address?.trim() || null,
      city: data.city?.trim() || null,
      area: data.area?.trim() || null,
      phone: data.phone?.trim() || null,
      whatsapp: data.whatsapp?.trim() || null,
      email: data.email?.trim() || null,
      total_capacity: data.total_capacity ?? 0,
      country,
      property_type: data.property_type?.trim() || null,
      hostel_type: (ACCOMMODATION_TYPE_VALUES as readonly string[]).includes(data.hostel_type ?? "")
        ? data.hostel_type
        : null,
      amenities: [],
      listing_enabled: true,
    };
    if (copySource) {
      for (const f of COPYABLE_HOSTEL_FIELDS) {
        if (copySource[f] !== undefined && copySource[f] !== null) insertRow[f] = copySource[f];
      }
    }

    // PAY FIRST. Charge the prorated tier difference and CONFIRM it succeeded before
    // creating anything. chargeTierUpgradeForOwner fails closed: if Paddle can't take
    // the payment (or the change didn't apply), it returns ok:false and we return the
    // error WITHOUT creating the property — so a property never exists on an unpaid
    // upgrade. When no charge is due (within-tier add, manual/PK, grandfathered, or
    // trial/no live subscription) it returns ok:true, applied:false and we proceed.
    const charge = await chargeTierUpgradeForOwner(user.id, toTier);
    if (!charge.ok) {
      return {
        error:
          charge.error ??
          "We couldn't process the upgrade payment, so the property wasn't created. Please check your billing details and try again.",
      };
    }

    // Defense-in-depth immediately before the irreversible INSERT (belt to the
    // lock's braces), with NO awaits between these checks and the INSERT below:
    // 1) Re-assert we STILL hold the lock. If our fencing token is gone, another
    //    request preempted us — do NOT create (the charge, if any, self-corrects on
    //    the owner's retry, which sees the tier already advanced → no re-charge).
    // 2) Re-count billable properties. Under the lock this equals the pre-charge
    //    count; if it changed, serialization was somehow violated — abort rather
    //    than create a property the owner hasn't paid the right tier for.
    const { data: lockCheck } = await admin
      .from("hms_profiles")
      .select("billing_lock_token")
      .eq("id", user.id)
      .maybeSingle();
    if ((lockCheck as { billing_lock_token?: string | null } | null)?.billing_lock_token !== token) {
      return { error: "A property change is already in progress. Please wait a moment and try again." };
    }
    const { count: recount } = await admin
      .from("hms_hostels")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", user.id)
      .eq("billing_active", true);
    if ((recount ?? 0) !== (billableCount ?? 0)) {
      return { error: "Your properties changed while we were setting this up. Please try again." };
    }

    const { data: newHostel, error: insertErr } = await supabase
      .from("hms_hostels")
      .insert(insertRow)
      .select("*")
      .single();
    if (insertErr) return { error: insertErr.message };
    const newId = (newHostel as Hostel).id;

    // Link in junction table (non-primary). Non-fatal if it fails.
    const { error: jErr } = await supabase.from("hms_owner_hostels").insert({
      owner_id: user.id,
      hostel_id: newId,
      is_primary: false,
    });
    if (jErr) console.warn("[createBranch] junction insert failed:", jErr.message);

    // Package config: copy the source's rates, else seed a zeroed default.
    let seeded = false;
    if (data.copyFromHostelId) {
      const { data: srcCfg } = await admin
        .from("hms_package_configs")
        .select(PACKAGE_CONFIG_COLUMNS)
        .eq("hostel_id", data.copyFromHostelId)
        .maybeSingle();
      if (srcCfg) {
        await admin.from("hms_package_configs").upsert(
          { hostel_id: newId, ...(srcCfg as Record<string, unknown>) },
          { onConflict: "hostel_id", ignoreDuplicates: true }
        );
        seeded = true;
      }
    }
    if (!seeded) await seedDefaultPackageConfig(admin, newId);

    const billing: TierSyncResult = charge.applied
      ? { status: "charged", from: fromTier, to: toTier }
      : { status: "noop" };

    revalidatePath("/");
    // `count` was the owner's hostel count BEFORE this insert. A self-serve
    // account already has the auto-created starter hostel, so <= 1 means this is
    // the first property the owner has actively created (analytics: activation).
    return { hostel: newHostel as Hostel, billing, firstProperty: (count ?? 0) <= 1 };
  } catch (e) {
    unstable_rethrow(e);
    return { error: (e as Error).message };
  } finally {
    // Release the per-owner lock on every path — but ONLY if we still hold it.
    // Gating on the fencing token means a request whose stale lock was already
    // stolen can never wipe the successor's live lock.
    if (lockToken && ownerId) {
      await admin
        .from("hms_profiles")
        .update({ billing_lock_at: null, billing_lock_token: null })
        .eq("id", ownerId)
        .eq("billing_lock_token", lockToken);
    }
  }
}

/**
 * Preview what adding one property will cost, WITHOUT creating it or charging —
 * powers the "you'll be charged X to upgrade" confirmation before the owner
 * commits. Read-only and acts only on the authenticated user (no ownerId param),
 * so it is IDOR-safe as a public action.
 *
 * Returns capReached / enterpriseBlocked for the two hard stops, otherwise
 * { willCharge, amount?, currency?, fromTier, toTier }. `amount` is a minor-unit
 * string in `currency`. willCharge:true with no amount means the preview call
 * failed — the UI should warn that an upgrade charge applies without a figure.
 */
export async function previewAddProperty(): Promise<{
  ok: boolean;
  error?: string;
  capReached?: boolean;
  enterpriseBlocked?: boolean;
  willCharge?: boolean;
  amount?: string;
  currency?: string;
  fromTier?: PricingTier;
  toTier?: PricingTier;
}> {
  try {
    await requireOwnerWrite();
    const { supabase, user } = await getAuthedUser();

    const { count } = await supabase
      .from("hms_hostels")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", user.id);
    if ((count ?? 0) >= MAX_PROPERTIES) {
      return { ok: false, capReached: true, error: `You've reached the maximum of ${MAX_PROPERTIES} properties.` };
    }

    const { data: prof } = await supabase
      .from("hms_profiles")
      .select("country, custom_unit_amount_usd, plan")
      .eq("id", user.id)
      .maybeSingle();
    const p = prof as { country?: string | null; custom_unit_amount_usd?: number | null; plan?: string | null } | null;
    const ownerCountry = p?.country ?? null;
    const hasCustomRate = p?.custom_unit_amount_usd != null && Number(p.custom_unit_amount_usd) > 0;
    const onTierSystem = !isManualBankBilling(ownerCountry) && !hasCustomRate;
    const fromTier: PricingTier = asPlan(p?.plan) ?? "basic";

    const { count: billableCount } = await supabase
      .from("hms_hostels")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", user.id)
      .eq("billing_active", true);
    const toTier: PricingTier = tierForPropertyCount((billableCount ?? 0) + 1);

    if (onTierSystem && toTier === "enterprise") {
      return {
        ok: false,
        enterpriseBlocked: true,
        error:
          "You've reached our Business tier limit (10 properties). Enterprise plans are custom-quoted — please contact hello@yourpulse.io to add more.",
      };
    }

    const preview = await previewTierUpgradeForOwner(user.id, toTier);
    return {
      ok: true,
      willCharge: preview.willCharge,
      amount: preview.amount,
      currency: preview.currency,
      fromTier,
      toTier,
    };
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: (e as Error).message };
  }
}
