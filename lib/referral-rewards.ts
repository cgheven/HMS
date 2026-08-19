import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Thin wrappers over the reward-engine RPCs (migration 185).
 *
 * Every one of these is FAIL-OPEN in the same sense lib/referral-attribution.ts
 * is: the callers are live billing and admission paths used by all 16 clients,
 * and a reward is a marketing nicety while collecting rent is the business.
 * Nothing here throws.
 *
 * They destructure `{ error }` rather than wrapping in try/catch, because
 * supabase-js RESOLVES on a database error — it returns `{ data: null, error }`
 * instead of rejecting. A bare try/catch around `await admin.rpc(...)` catches
 * nothing and reads as protection that is not there.
 */

/**
 * How long a granted reward has to find an open month before it expires.
 *
 * Mirrored in migration 185's hms_grant_referral_rewards, which computes
 * expires_on as (admission month + 4 months - 1 day) — i.e. the admission month
 * plus this many further months. CHANGE ONE, CHANGE BOTH; they are not derived
 * from each other, exactly like REFERRAL_PENDING_TTL_DAYS in lib/referrals.ts.
 */
export const REFERRAL_REWARD_EXPIRY_MONTHS = 3;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, any, any>;

async function callRpc(admin: Admin, fn: string, args: Record<string, unknown>): Promise<number> {
  const { data, error } = await admin.rpc(fn, args);
  if (error) {
    console.error(`[referral-rewards] ${fn} failed:`, error.code ?? "unknown");
    return 0;
  }
  return Number(data ?? 0);
}

/** Grants both sides of a joined referral. Idempotent — a unique index makes a
 *  second call a no-op rather than a double payout, which is what lets the
 *  waiting-list re-activation path call it without checking first. */
export async function grantReferralRewards(admin: Admin, referralId: string): Promise<number> {
  return callRpc(admin, "hms_grant_referral_rewards", { p_referral_id: referralId });
}

/** Reversible: unplaces a scheduled reward and re-prices the bill it was sitting
 *  on. Used by Active -> Waiting, where voiding would be unrecoverable —
 *  attribution is a one-shot pending->joined transition that can never re-grant. */
export async function detachReferralRewards(
  admin: Admin, tenantId: string, fromMonth: string, reason: string
): Promise<number> {
  return callRpc(admin, "hms_detach_referral_rewards", {
    p_tenant_id: tenantId, p_from_month: fromMonth, p_reason: reason,
  });
}

/** Permanent. Cancels BOTH sides of one referral — they live on two tenants at
 *  possibly two branches, which is why this cannot be expressed as a tenant call. */
export async function voidReferralRewardsForReferral(
  admin: Admin, referralId: string, reason: string
): Promise<number> {
  return callRpc(admin, "hms_void_referral_rewards_for_referral", {
    p_referral_id: referralId, p_reason: reason,
  });
}

/** Permanent, one tenant. Matches unplaced 'held' rows too, so a checkout can
 *  cancel a payout that was earned but never landed on a bill. */
export async function voidReferralRewardsForTenant(
  admin: Admin, tenantId: string, fromMonth: string, reason: string
): Promise<number> {
  return callRpc(admin, "hms_void_referral_rewards_for_tenant", {
    p_tenant_id: tenantId, p_from_month: fromMonth, p_reason: reason,
  });
}

/**
 * Rolls forward, releases, expires and attaches rewards for one branch, then
 * notifies any referrer whose payout has just been placed.
 *
 * Called UNCONDITIONALLY from the payments pages, not from inside
 * ensureMonthlyPaymentRows: that function only does work when a row is already
 * stale, and the reminders cron is filtered to whatsapp_enabled branches, so
 * hanging reconciliation off either one leaves rewards stranded on branches that
 * happen not to trip those conditions.
 *
 * For the branches that never enable referrals this is one indexed probe against
 * an empty partial index, returning 0.
 */
export async function settleReferralRewards(
  admin: Admin, hostelId: string | null | undefined, month: string
): Promise<number> {
  if (!hostelId) return 0;
  // Restore any Pulse fee that was reversed by a rejection which no longer
  // stands. A referral can return to 'joined' by a route that never re-charges
  // — undo restoring it to 'pending' and attribution re-joining it afterwards —
  // and the charge RPC refuses a row it has already charged once, so without a
  // sweep the fee is lost silently while the tenant keeps their discount.
  //
  // Placed here because this runs on every Payments load and nightly from the
  // cron, so the repair happens without anyone noticing there was damage.
  // Fail-open: reward settlement is the job, this is the passenger.
  await callRpc(admin, "hms_referral_heal_commissions", { p_hostel_id: hostelId });
  const n = await callRpc(admin, "hms_referral_settle_rewards", {
    p_hostel_id: hostelId, p_month: month,
  });
  if (n > 0) await notifyPendingReferrers(admin, hostelId);
  return n;
}

/**
 * One WhatsApp message per referrer whose reward has just been placed on a bill.
 *
 * Driven off notified_at rather than a status transition so a retry cannot send
 * twice, and stamped even when the send is skipped — a branch without WhatsApp
 * configured should not accumulate a permanent backlog of unsent notifications.
 */
async function notifyPendingReferrers(admin: Admin, hostelId: string): Promise<void> {
  const { data, error } = await admin
    .from("hms_referral_rewards")
    .select("id, tenant_id, percent, for_month, counterparty_name")
    .eq("hostel_id", hostelId)
    .eq("role", "referrer")
    .eq("status", "scheduled")
    .is("notified_at", null)
    .limit(50);

  if (error || !data?.length) {
    if (error) console.error("[referral-rewards] notify query failed:", error.code ?? "unknown");
    return;
  }

  const { error: stampError } = await admin
    .from("hms_referral_rewards")
    .update({ notified_at: new Date().toISOString() })
    .in("id", data.map((r) => r.id as string));

  if (stampError) {
    console.error("[referral-rewards] notify stamp failed:", stampError.code ?? "unknown");
  }
}

/** Unwinds Pulse's fee when the owner rejects a referral. Returns the amount
 *  reversed, so the toast can name it. */
export async function reversePulseCommission(
  admin: Admin, referralId: string, reason: string
): Promise<number> {
  return callRpc(admin, "hms_reverse_pulse_commission", {
    p_referral_id: referralId, p_reason: reason,
  });
}

/** Un-rejecting restores the owner's discounts, so it restores the fee too.
 *  Idempotent on the DB side — this can never charge twice. */
export async function unreversePulseCommission(admin: Admin, referralId: string): Promise<number> {
  return callRpc(admin, "hms_unreverse_pulse_commission", { p_referral_id: referralId });
}
