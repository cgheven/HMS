"use server";

import { getReferralStatus, type ReferralStatus } from "@/lib/referral-status";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientIp } from "@/lib/referrals-server";
import { REFERRAL_VIEW_HOURLY_LIMIT } from "@/lib/referrals";

// UNAUTHENTICATED, and ONE export on purpose: every export of a "use server"
// module is a public POST endpoint. Token minting and every other helper live in
// lib/referral-status.ts, which is "server-only" and unreachable from a browser.

export async function checkReferralStatus(
  token: unknown,
  phone: unknown
): Promise<{ data?: ReferralStatus; error?: string }> {
  try {
    const rawToken = typeof token === "string" ? token : "";
    const rawPhone = typeof phone === "string" ? phone : "";
    // Coerced and capped before anything touches them: these arrive as
    // attacker-controlled JSON of arbitrary shape.
    if (rawToken.length > 64 || rawPhone.length > 20) {
      return { error: "That doesn't look right. Please check and try again." };
    }

    // Metered per IP. The phone is the only thing an attacker holding a stray
    // link has to guess, so the guessing has to cost something.
    const ip = await clientIp();
    const { data: allowed, error: rateErr } = await createAdminClient().rpc(
      "hms_referral_rate_hit",
      { p_bucket: `status:${ip ?? "unknown"}`, p_limit: REFERRAL_VIEW_HOURLY_LIMIT }
    );
    // Fail closed: an unverifiable ceiling is no ceiling.
    if (rateErr || allowed === false) {
      return { error: "Too many attempts. Please try again later." };
    }

    const data = await getReferralStatus(rawToken, rawPhone);

    // ONE message for a bad token and for a wrong number alike. Telling the
    // caller which half was wrong turns this into an oracle: a stray link plus a
    // distinguishable error is a phone-number confirmation service.
    if (!data) {
      return { error: "We couldn't find that. Please check your mobile number and try again." };
    }
    return { data };
  } catch {
    return { error: "Something went wrong. Please try again." };
  }
}
