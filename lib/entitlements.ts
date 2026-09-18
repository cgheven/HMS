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
 * Standard-only capabilities that a plan grants. Maps onto the branded-subdomain
 * flag (hms_profiles.subdomain_enabled) — the plan is the source of truth and DRIVES
 * it. Hotel Eye is a Basic feature on both plans and stays on its own provisioning
 * flag, so it is deliberately NOT touched here.
 *
 * WhatsApp automation (hms_hostels.whatsapp_enabled) is NOT plan-driven — granted
 * ONLY via the Super Admin toggle (setWhatsappEnabled).
 *
 * The REFERRAL programme (hms_hostels.referral_enabled) is also NOT plan-driven any
 * more: it is a FREE feature, DEFAULT-ON for every branch (DB default true, migration
 * 258). A plan event never touches it, so a downgrade to Basic can't turn referrals
 * off; Super Admin can still disable one branch via setReferralEnabled. Referrals are
 * free — no commission is charged.
 */
export interface PlanEntitlements {
  brandedSubdomain: boolean;
}

export function entitlementsForPlan(plan: Plan): PlanEntitlements {
  // Every paid tier (standard / business / enterprise) grants the same paid
  // capabilities; only Basic is the entry tier. Business ⊇ Standard is a higher
  // property cap + price, not a new feature set.
  const paid = plan !== "basic";
  return { brandedSubdomain: paid };
}

/**
 * Make the owner's capability flags match their plan. Runs under the service-role
 * client (Paddle webhook or Super Admin action), which passes the guard triggers.
 *
 * - subdomain_enabled (owner-level): set to the plan's entitlement. Turning it
 *   OFF only blocks NEW claims — migration 167 never tears down an already-claimed
 *   subdomain, so a downgrade cannot break a live site.
 *
 * referral_enabled and whatsapp_enabled are intentionally NOT touched here (see the
 * note on PlanEntitlements): referrals are free + default-on for everyone, and
 * WhatsApp is manual-only. A plan event changes neither.
 *
 * Idempotent: safe to call on every relevant webhook event.
 */
export async function applyPlanEntitlements(
  admin: SupabaseClient,
  ownerId: string,
  plan: Plan
): Promise<void> {
  const ent = entitlementsForPlan(plan);
  const [profRes] = await Promise.all([
    admin.from("hms_profiles").update({ subdomain_enabled: ent.brandedSubdomain }).eq("id", ownerId),
  ]);
  // supabase-js does NOT throw on a DB error — it returns { error }. Surface it so
  // the caller (the webhook) fails loudly and retries, rather than silently
  // leaving a paid account un-entitled.
  if (profRes.error) throw new Error(`applyPlanEntitlements(subdomain): ${profRes.error.message}`);
}
