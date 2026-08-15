"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { normalizePhoneDigits } from "@/lib/phone";
import { clientIp } from "@/lib/referrals-server";
import {
  MAX_PENDING_PER_REFERRER,
  REFERRAL_CODE_INPUT_MAX_LENGTH,
  REFERRAL_HONEYPOT_MAX_LENGTH,
  REFERRAL_HOSTEL_HOURLY_LIMIT,
  REFERRAL_IP_HOURLY_LIMIT,
  REFERRAL_IP_LINK_HOURLY_LIMIT,
  REFERRAL_NAME_MAX_LENGTH,
  REFERRAL_PHONE_MAX_LENGTH,
  isReferrableMobile,
  normalizeReferralCode,
} from "@/lib/referrals";

// UNAUTHENTICATED. Anyone holding a link reaches everything in this file, so it
// trusts nothing but the code — and the code buys exactly one thing: permission
// to insert one row. Nothing here ever returns the referrer's phone, the
// hostel's ids, its occupancy, or any tenant name.
//
// submitReferral is the ONLY export on purpose: every export of a "use server"
// module is a public POST endpoint, so code resolution lives in
// lib/referrals-server.ts ("server-only") and is called by the page directly.
//
// The tables have RLS on with zero policies and no grants to anon (migration
// 173), so every statement below runs on the service-role client by necessity.

/** One message for every failure that could otherwise identify a real code:
 *  unknown, rotated, referrer checked out, branch not entitled. */
const DEAD_LINK = "This referral link is no longer active.";

const GENERIC_ERROR = "Something went wrong. Please try again.";

export interface ReferralSubmission {
  name: string;
  phone: string;
  /** Honeypot — a real person never sees this field, let alone fills it. */
  website_url?: string;
}

/**
 * Every silent-success path gets a line here.
 *
 * Four different refusals answer the visitor identically, by design — telling a
 * bot which ceiling it hit tells it there is one. But identical to SUPPORT as
 * well means "Ali says he sent his cousin's number and it isn't on my page" is
 * unanswerable. Reason and code id only: never the name, the phone or the IP.
 */
function logDrop(reason: string, code: string) {
  console.warn(`[submitReferral] dropped: reason=${reason} code=${code ? "present" : "empty"}`);
}

export async function submitReferral(
  code: unknown,
  submission: unknown
): Promise<{ success: boolean; error?: string }> {
  try {
    // Server-action arguments are attacker-controlled JSON of arbitrary shape.
    // Coerce before touching .length or .trim(), or a numeric `name` turns the
    // public form into a 500 generator.
    const fields = (submission ?? {}) as Partial<Record<keyof ReferralSubmission, unknown>>;
    const rawCode = typeof code === "string" ? code : "";
    const rawName = typeof fields.name === "string" ? fields.name : "";
    const rawPhone = typeof fields.phone === "string" ? fields.phone : "";
    const rawHoneypot = typeof fields.website_url === "string" ? fields.website_url : "";

    // Length caps genuinely first — before the honeypot branch, which used to
    // jump the queue and .trim() an uncapped string. serverActions.bodySizeLimit
    // is 30mb and this endpoint is open to the world, so copying a 30MB string
    // is work an anonymous caller must not be able to buy.
    if (
      rawCode.length > REFERRAL_CODE_INPUT_MAX_LENGTH ||
      rawName.length > REFERRAL_NAME_MAX_LENGTH ||
      rawPhone.length > REFERRAL_PHONE_MAX_LENGTH ||
      rawHoneypot.length > REFERRAL_HONEYPOT_MAX_LENGTH
    ) {
      return { success: false, error: GENERIC_ERROR };
    }

    // Bot filled the honeypot — succeed from its point of view and write nothing.
    if (rawHoneypot.trim() !== "") {
      logDrop("honeypot", rawCode);
      return { success: true };
    }

    const name = rawName.trim();
    const phone = rawPhone.trim();
    if (!name) return { success: false, error: "Please enter their name." };
    if (!phone) return { success: false, error: "Please enter their mobile number." };

    const phoneDigits = normalizePhoneDigits(phone);
    if (!phoneDigits || !isReferrableMobile(phoneDigits)) {
      return { success: false, error: "Please enter a valid mobile number." };
    }

    const normalizedCode = normalizeReferralCode(rawCode);
    if (!normalizedCode) return { success: false, error: DEAD_LINK };

    const ipAddress = await clientIp();
    const admin = createAdminClient();

    // Resolution, all four ceilings and the insert in ONE transaction that
    // serializes on the code row. The previous COUNT-then-INSERT shape let a
    // parallel burst read the same pre-burst count and every request insert.
    const { data, error } = await admin.rpc("hms_submit_referral", {
      p_code: normalizedCode,
      p_name: name,
      p_phone: phone,
      p_phone_digits: phoneDigits,
      p_ip: ipAddress,
      p_max_pending: MAX_PENDING_PER_REFERRER,
      p_ip_link_hourly_limit: REFERRAL_IP_LINK_HOURLY_LIMIT,
      p_ip_hourly_limit: REFERRAL_IP_HOURLY_LIMIT,
      p_hostel_hourly_limit: REFERRAL_HOSTEL_HOURLY_LIMIT,
    });

    if (error) {
      // Code only — a PostgREST constraint message can carry the offending
      // column value, i.e. the referred person's number, into the logs.
      console.error("[submitReferral] RPC error:", error.code ?? "unknown");
      return { success: false, error: GENERIC_ERROR };
    }

    switch (data) {
      case "ok":
        return { success: true };
      case "dead_link":
        return { success: false, error: DEAD_LINK };
      // Silent success for every abuse ceiling and for the duplicate: telling a
      // bot it hit a limit tells it there is one, and the duplicate really is a
      // success for whoever is standing at the form — the number is already
      // referred. The owner sees the collision on the Marketing page.
      case "ip_link_limit":
      case "ip_limit":
      case "hostel_limit":
      case "referrer_cap":
      case "duplicate":
        logDrop(String(data), rawCode);
        return { success: true };
      default:
        console.error("[submitReferral] unexpected RPC result");
        return { success: false, error: GENERIC_ERROR };
    }
  } catch (e) {
    console.error("[submitReferral] unexpected error:", e instanceof Error ? e.message : "unknown");
    return { success: false, error: GENERIC_ERROR };
  }
}
