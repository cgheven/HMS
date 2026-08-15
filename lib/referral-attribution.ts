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
    /** The tenant's check_in. Falls back to today when a path leaves it unset. */
    checkIn?: string | null;
  }
): Promise<void> {
  try {
    const digits = normalizePhoneDigits(args.phone);
    if (!digits) return;

    // Entitlement is per branch and Super Admin controlled. Checked first so a
    // branch without the feature does no further work on its admission path.
    const { data: hostel } = await admin
      .from("hms_hostels")
      .select("referral_enabled, owner_id")
      .eq("id", args.hostelId)
      .maybeSingle();
    if (!hostel?.referral_enabled) return;

    // Owner-scoped, not branch-scoped: a referral pays out when the person joins
    // ANY branch that owner owns, which is how the owner reads it — they filled
    // a seat either way.
    const { data: referral } = await admin
      .from("hms_referrals")
      .select("id, created_at")
      .eq("owner_id", hostel.owner_id)
      .eq("phone_digits", digits)
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!referral) return;

    // The deadline, evaluated against the admission rather than "now". Dates
    // only: check_in is a DATE column while created_at is a timestamp, and
    // comparing them raw would drop a same-day admission.
    const submitted = new Date(String(referral.created_at).slice(0, 10) + "T00:00:00Z");
    const admitted = new Date((args.checkIn ?? new Date().toISOString()).slice(0, 10) + "T00:00:00Z");
    const days = Math.floor((admitted.getTime() - submitted.getTime()) / 86_400_000);
    if (!Number.isFinite(days) || days < 0 || days > REFERRAL_PENDING_TTL_DAYS) return;

    // .eq("status","pending") makes this idempotent and stops a referral the
    // owner already rejected being revived by a later admission.
    await admin
      .from("hms_referrals")
      .update({
        status: "joined",
        matched_tenant_id: args.tenantId,
        matched_at: args.checkIn ?? new Date().toISOString().slice(0, 10),
      })
      .eq("id", referral.id)
      .eq("status", "pending");
  } catch (err) {
    console.error(
      "[linkReferralForNewTenant] attribution skipped:",
      err instanceof Error ? err.message : "unknown"
    );
  }
}
