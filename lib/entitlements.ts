import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Account-level Pulse plan. NULL/unknown = "no explicit plan" → callers fall
// back to today's per-capability flags (blocks nobody).
export type Plan = "basic" | "standard";

export function asPlan(value: string | null | undefined): Plan | null {
  return value === "basic" || value === "standard" ? value : null;
}

/**
 * Standard-only capabilities that a plan grants. These map 1:1 onto existing
 * per-capability flags (hms_profiles.subdomain_enabled, hms_hostels.referral_enabled)
 * — the plan is the source of truth and DRIVES those flags, so every existing
 * enforcement point keeps working unchanged. WhatsApp and Hotel Eye are Basic
 * features available on both plans and stay governed by their own provisioning
 * flags, so they are deliberately NOT touched here.
 */
export interface PlanEntitlements {
  brandedSubdomain: boolean;
  referralEngine: boolean;
}

export function entitlementsForPlan(plan: Plan): PlanEntitlements {
  const standard = plan === "standard";
  return { brandedSubdomain: standard, referralEngine: standard };
}

/**
 * Make the owner's capability flags match their plan. Runs under the service-role
 * client (Paddle webhook or Super Admin action), which passes the guard triggers.
 *
 * - subdomain_enabled (owner-level): set to the plan's entitlement. Turning it
 *   OFF only blocks NEW claims — migration 167 never tears down an already-claimed
 *   subdomain, so a downgrade cannot break a live site.
 * - referral_enabled (per-branch): set on every branch the owner holds.
 *
 * Idempotent: safe to call on every relevant webhook event.
 */
export async function applyPlanEntitlements(
  admin: SupabaseClient,
  ownerId: string,
  plan: Plan
): Promise<void> {
  const ent = entitlementsForPlan(plan);
  const [profRes, hostelRes] = await Promise.all([
    admin.from("hms_profiles").update({ subdomain_enabled: ent.brandedSubdomain }).eq("id", ownerId),
    admin.from("hms_hostels").update({ referral_enabled: ent.referralEngine }).eq("owner_id", ownerId),
  ]);
  // supabase-js does NOT throw on a DB error — it returns { error }. Surface it so
  // the caller (the webhook) fails loudly and retries, rather than silently
  // leaving a paid account un-entitled.
  if (profRes.error) throw new Error(`applyPlanEntitlements(subdomain): ${profRes.error.message}`);
  if (hostelRes.error) throw new Error(`applyPlanEntitlements(referral): ${hostelRes.error.message}`);
}
