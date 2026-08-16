"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { EMAIL_RE } from "@/lib/validation";

/**
 * Password reset — request step.
 *
 * Deliberately thin. The TOKEN is Supabase's: generation, hashing at rest,
 * expiry and single-use are already implemented and audited there, and those
 * four things are exactly what a hand-rolled reset gets wrong. Rolling our own
 * would mean inventing cryptography on the one endpoint where a mistake is a
 * full account takeover with no credentials needed.
 *
 * What Supabase does NOT give us, and what this file is for:
 *   - a response that cannot be used to learn which addresses are registered
 *   - rate limiting that fails CLOSED
 *   - refusing deactivated accounts
 *   - refusing the synthetic manager identities, which have no real inbox
 */

/** Per hour, per address. Generous for a real person who mistypes; useless as a
 *  mail cannon aimed at one inbox. */
const EMAIL_HOURLY_LIMIT = 5;
/** Per hour, per IP. Higher because a hostel office is one NAT for many staff,
 *  but low enough that enumeration across many addresses is not free. */
const IP_HOURLY_LIMIT = 20;

/**
 * Managers authenticate by phone; app/(auth)/login/page.tsx mints
 * `${digits}@hms-portal.internal` for them. That domain does not exist and
 * nobody receives mail there, so a reset link sent to it is silently lost.
 * Five of six managers are in this state. They are excluded, and the login page
 * does not offer them the link — an offer that silently fails is worse than no
 * offer.
 */
const SYNTHETIC_EMAIL_DOMAIN = "@hms-portal.internal";

/** One sentence, used for every outcome. See the non-enumeration note below. */
const UNIFORM_RESPONSE =
  "If that email is registered, a reset link is on its way. Check your inbox and spam folder.";

async function clientIp(): Promise<string> {
  try {
    const h = await headers();
    return (
      h.get("x-vercel-forwarded-for") ||
      h.get("x-real-ip") ||
      // Rightmost entry: the trusted proxy sets it, the client controls the left.
      h.get("x-forwarded-for")?.split(",").at(-1)?.trim() ||
      "unknown"
    );
  } catch {
    return "unknown";
  }
}

/**
 * ALWAYS returns the same message.
 *
 * Not politeness — an endpoint that answers "no such account" is a free
 * membership oracle for every address an attacker holds, and the addresses here
 * belong to hostel owners whose accounts hold their clients' financial records.
 * A refusal for rate limiting, a deactivated account, a synthetic manager
 * address and a genuine send are indistinguishable to the caller.
 *
 * Residual, and worth stating rather than hiding: the eligible path makes one
 * extra network call to Supabase's mail service, so a determined attacker with
 * a clean statistical setup could time the difference. Closing it fully would
 * mean issuing a decoy send, which is its own abuse vector. The rate limits are
 * what bound exploitation, and the pentest should rule on whether that is
 * acceptable rather than my assuming it.
 */
export async function requestPasswordReset(
  email: string
): Promise<{ message: string }> {
  const address = (email ?? "").trim().toLowerCase();

  // Shape only. An invalid address is not worth a database round trip, and
  // answering identically means this branch leaks nothing either.
  if (!address || address.length > 254 || !EMAIL_RE.test(address)) {
    return { message: UNIFORM_RESPONSE };
  }

  try {
    const admin = createAdminClient();
    const ip = await clientIp();

    // Both ceilings are charged before any decision, and BOTH fail closed: an
    // unverifiable limit is no limit. Per-IP first so probing many addresses
    // from one host is bounded even when each address is under its own ceiling.
    const [{ data: ipOk, error: ipErr }, { data: emailOk, error: emailErr }] = await Promise.all([
      admin.rpc("hms_auth_rate_hit", { p_bucket: `pwreset:ip:${ip}`, p_limit: IP_HOURLY_LIMIT }),
      admin.rpc("hms_auth_rate_hit", { p_bucket: `pwreset:email:${address}`, p_limit: EMAIL_HOURLY_LIMIT }),
    ]);
    if (ipErr || emailErr || ipOk === false || emailOk === false) {
      console.warn("[requestPasswordReset] refused:", ipErr || emailErr ? "rate check failed" : "over limit");
      return { message: UNIFORM_RESPONSE };
    }

    // A synthetic manager address has no inbox; a deactivated account must not
    // be able to reset its way back in. Neither is reported to the caller.
    if (address.endsWith(SYNTHETIC_EMAIL_DOMAIN)) {
      console.info("[requestPasswordReset] skipped: synthetic manager address");
      return { message: UNIFORM_RESPONSE };
    }

    const { data: profile } = await admin
      .from("hms_profiles")
      .select("id, is_active")
      .eq("email", address)
      .maybeSingle();

    if (!profile || profile.is_active === false) {
      console.info("[requestPasswordReset] skipped:", profile ? "deactivated account" : "no account");
      return { message: UNIFORM_RESPONSE };
    }

    // Sent through the SESSION client, not the admin one. generateLink() on the
    // admin client would hand this server the raw recovery token, which would
    // then exist in memory and in any log that captured it. resetPasswordForEmail
    // keeps the token strictly between Supabase and the user's inbox.
    const supabase = await createClient();
    const origin = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://hostel.yourpulse.io").replace(/\/+$/, "");
    const { error } = await supabase.auth.resetPasswordForEmail(address, {
      redirectTo: `${origin}/reset-password`,
    });
    if (error) {
      // Logged by code only. The message can name the address.
      console.error("[requestPasswordReset] send failed:", error.status ?? "unknown");
    }

    return { message: UNIFORM_RESPONSE };
  } catch (err) {
    console.error(
      "[requestPasswordReset] unexpected:",
      err instanceof Error ? err.message : "unknown"
    );
    // Still uniform: an error here must not become the one distinguishable answer.
    return { message: UNIFORM_RESPONSE };
  }
}
