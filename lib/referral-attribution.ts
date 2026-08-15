import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizePhoneDigits } from "@/lib/phone";
import { REFERRAL_PENDING_TTL_DAYS } from "@/lib/referrals";

/**
 * Links a newly admitted tenant to the referral that brought them in.
 *
 * Called from every path that admits a tenant, at the moment of admission. That
 * placement is the whole point: attribution is a fact about the admission, so it
 * is decided when the admission happens and never depends on anybody opening a
 * screen afterwards.
 *
 * The earlier design derived the match when the Marketing page loaded. It had
 * two defects that both disappear here rather than being fixed:
 *   - the 14-day deadline was measured against the wall clock, so a person who
 *     moved in on day 3 lost their referral if nobody opened the page by day 14;
 *   - the page rendered "joined" from the match it intended to write, not from
 *     the write that committed.
 * Here the deadline is submission date to admission date, which is the same
 * answer whenever it is asked, and the row is written once by the code that
 * knows the admission succeeded.
 *
 * FAIL-OPEN, ALWAYS. Every caller is a live admission path used by all 16
 * clients. A referral is a marketing nicety; admitting a tenant is the business.
 * Nothing in here may throw, and every caller invokes it AFTER the tenant row
 * is committed, so a failure loses an attribution and never a tenant.
 */
export async function linkReferralForNewTenant(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  args: {
    tenantId: string;
    hostelId: string;
    phone: string | null | undefined;
    /** The tenant's check_in. Null falls back to today, at PKT, inside the RPC. */
    checkIn?: string | null;
  }
): Promise<void> {
  try {
    const digits = normalizePhoneDigits(args.phone);
    if (!digits) return;

    // ONE round trip. Entitlement, the deadline and the write all happen inside
    // hms_attribute_referral (migration 178), so this costs a single hop on the
    // busiest write path in the product rather than three, and the decision is
    // atomic — two concurrent admissions of the same number cannot both claim
    // one referral.
    //
    // The deadline lives in SQL rather than here on purpose: check_in is a DATE
    // and created_at a timestamptz, the business runs at UTC+5, and doing that
    // arithmetic in JS shifted the window by a day for anything submitted before
    // 05:00 PKT.
    const { data, error } = await admin.rpc("hms_attribute_referral", {
      p_tenant_id: args.tenantId,
      p_hostel_id: args.hostelId,
      p_phone_digits: digits,
      p_check_in: args.checkIn ?? null,
      p_ttl_days: REFERRAL_PENDING_TTL_DAYS,
    });

    // Logged, never thrown. Every caller is a live admission path: a referral is
    // a marketing nicety, admitting a tenant is the business.
    if (error) {
      console.error("[linkReferralForNewTenant] attribution failed:", error.code ?? "unknown");
      return;
    }
    if (data === true) {
      console.info("[linkReferralForNewTenant] referral attributed to tenant", args.tenantId);
    }
  } catch (err) {
    console.error(
      "[linkReferralForNewTenant] attribution skipped:",
      err instanceof Error ? err.message : "unknown"
    );
  }
}
