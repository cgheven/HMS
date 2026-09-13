import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Account-level Pulse plan. NULL/unknown = "no explicit plan" → callers fall
// back to today's per-capability flags (blocks nobody).
export type Plan = "basic" | "standard" | "business" | "enterprise";

const PLANS: readonly Plan[] = ["basic", "standard", "business", "enterprise"];

export function asPlan(value: string | null | undefined): Plan | null {
  return PLANS.includes(value as Plan) ? (value as Plan) : null;
}

/**
 * Standard-only capabilities that a plan grants. These map 1:1 onto existing
 * per-capability flags (hms_profiles.subdomain_enabled, hms_hostels.referral_enabled,
 * hms_hostels.whatsapp_enabled) — the plan is the source of truth and DRIVES those
 * flags, so every existing enforcement point keeps working unchanged. Hotel Eye is
 * a Basic feature on both plans and stays on its own provisioning flag, so it is
 * deliberately NOT touched here.
 */
export interface PlanEntitlements {
  brandedSubdomain: boolean;
  referralEngine: boolean;
  whatsappAutomation: boolean;
}

export function entitlementsForPlan(plan: Plan): PlanEntitlements {
  // Every paid tier (standard / business / enterprise) grants the same paid
  // capabilities; only Basic is the entry tier. Business ⊇ Standard is a higher
  // property cap + price, not a new feature set.
  const paid = plan !== "basic";
  return { brandedSubdomain: paid, referralEngine: paid, whatsappAutomation: paid };
}

/**
 * Make the owner's capability flags match their plan. Runs under the service-role
 * client (Paddle webhook or Super Admin action), which passes the guard triggers.
 *
 * - subdomain_enabled (owner-level): set to the plan's entitlement. Turning it
 *   OFF only blocks NEW claims — migration 167 never tears down an already-claimed
 *   subdomain, so a downgrade cannot break a live site.
 * - referral_enabled (per-branch): set on every branch the owner holds.
 * - whatsapp_enabled (per-branch): set on every branch. Standard grants WhatsApp
 *   automation; a downgrade to Basic turns it off (Basic doesn't include it). All
 *   sends already gate on this flag, so nothing else changes.
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
    admin
      .from("hms_hostels")
      .update({ referral_enabled: ent.referralEngine, whatsapp_enabled: ent.whatsappAutomation })
      .eq("owner_id", ownerId),
  ]);
  // supabase-js does NOT throw on a DB error — it returns { error }. Surface it so
  // the caller (the webhook) fails loudly and retries, rather than silently
  // leaving a paid account un-entitled.
  if (profRes.error) throw new Error(`applyPlanEntitlements(subdomain): ${profRes.error.message}`);
  if (hostelRes.error) throw new Error(`applyPlanEntitlements(referral/whatsapp): ${hostelRes.error.message}`);
}
