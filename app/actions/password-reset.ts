"use server";

import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPasswordResetEmail } from "@/lib/email";
import { EMAIL_RE } from "@/lib/validation";
import { siteUrl } from "@/lib/site-url";

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
 *   - refusing the synthetic manager identities, which have no real inbox
 */

/** Per hour, per address. Generous for a real person who mistypes; useless as a
 *  mail cannon aimed at one inbox. */
const EMAIL_HOURLY_LIMIT = 10;
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

/** Stated in the email so nobody sits on a link. Must match the Supabase
 *  project's own recovery expiry — the code cannot enforce it, so if that
 *  setting is changed this constant has to move with it. */
const RECOVERY_LINK_MINUTES = 60;

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
  // Guarded because this line sits OUTSIDE the try below: a non-string argument
  // (trivial to send by calling the action endpoint directly) threw a TypeError
  // before any handler ran, making a 500 the one answer that differed from the
  // other nine.
  if (typeof email !== "string") {
    return { message: UNIFORM_RESPONSE };
  }
  const address = email.trim().toLowerCase();

  // Shape only. An invalid address is not worth a database round trip, and
  // answering identically means this branch leaks nothing either.
  if (!address || address.length > 254 || !EMAIL_RE.test(address)) {
    return { message: UNIFORM_RESPONSE };
  }

  try {
    const admin = createAdminClient();
    const ip = await clientIp();

    // The per-IP ceiling is charged FIRST and unconditionally: every caller pays
    // for every attempt, whatever the address turns out to be. Fails closed,
    // because an unverifiable limit is no limit.
    const { data: ipOk, error: ipErr } = await admin.rpc("hms_auth_rate_hit", {
      p_bucket: `pwreset:ip:${ip}`,
      p_limit: IP_HOURLY_LIMIT,
    });
    if (ipErr || ipOk === false) {
      console.warn("[requestPasswordReset] refused:", ipErr ? "rate check failed" : "ip over limit");
      return { message: UNIFORM_RESPONSE };
    }

    // A synthetic manager address has no inbox; a deactivated account must not
    // be able to reset its way back in. Neither is reported to the caller.
    if (address.endsWith(SYNTHETIC_EMAIL_DOMAIN)) {
      console.info("[requestPasswordReset] skipped: synthetic manager address");
      return { message: UNIFORM_RESPONSE };
    }

    // .limit(2), not .maybeSingle(). maybeSingle() ERRORS when more than one row
    // matches, and the previous version discarded that error — so planting a
    // second profile row carrying a victim's address permanently and silently
    // disabled their recovery, with nothing logged. Public signup is open on this
    // project and hms_profiles has no unique index on email, so that is a
    // reachable state, not a hypothetical one. Two rows now means "match" and a
    // loud log, never "no account".
    const { data: profiles, error: lookupErr } = await admin
      .from("hms_profiles")
      .select("id, full_name")
      .eq("email", address)
      .limit(2);

    if (lookupErr) {
      // Distinguished from "no account" on purpose: a failing lookup is our
      // problem and must be visible, not silently swallowed as a missing user.
      console.error("[requestPasswordReset] profile lookup failed:", lookupErr.code ?? "unknown");
      return { message: UNIFORM_RESPONSE };
    }
    if (profiles && profiles.length > 1) {
      console.error("[requestPasswordReset] DUPLICATE PROFILE for this address — investigate");
    }
    const profile = profiles?.[0] ?? null;

    // NOTE: there is deliberately no is_active check here.
    //
    // An earlier version had one, and it was worse than useless. hms_profiles
    // .is_active is writable by the account it belongs to — an authenticated
    // user can set their own false and true again — so it could never keep
    // anyone out. Nothing in this codebase ever sets it false either; real
    // deactivation lives in hms_sales_reps.is_active and
    // hms_partnerships.is_active, which are role-specific and not consulted by
    // any login path. is_active is not checked at sign-in at all, so gating
    // reset on it would have been stricter than the front door anyway.
    //
    // Removed rather than repaired: dead security code is worse than none,
    // because the next reader believes the protection exists. If account
    // suspension is wanted, it belongs at LOGIN first, on a column the user
    // cannot write.
    if (!profile) {
      console.info("[requestPasswordReset] skipped: no account");
      return { message: UNIFORM_RESPONSE };
    }

    // Charged only now, immediately before a mail actually goes out. Charging it
    // up front let anyone deny a named owner their only self-service recovery
    // path by burning the ceiling with requests that were never going to send.
    const { data: emailOk, error: emailErr } = await admin.rpc("hms_auth_rate_hit", {
      p_bucket: `pwreset:email:${address}`,
      p_limit: EMAIL_HOURLY_LIMIT,
    });
    if (emailErr || emailOk === false) {
      console.warn("[requestPasswordReset] refused:", emailErr ? "rate check failed" : "address over limit");
      return { message: UNIFORM_RESPONSE };
    }

    // generateLink, then OUR OWN email through Resend — the same sender and the
    // same template file as every invoice and receipt this product sends.
    //
    // This deliberately reverses an earlier decision. resetPasswordForEmail was
    // chosen so the raw token never touched this server, but @supabase/ssr
    // hard-codes flowType "pkce", so the code_verifier was minted in whichever
    // browser submitted the form and the emailed link died on any other device.
    // A token_hash link carries no per-browser state and is verified server-side
    // at /auth/confirm, so it works anywhere AND the token never reaches a
    // browser at all — not the address bar, not history, not a Referer header.
    //
    // The cost, stated plainly: the recovery token exists in this function's
    // memory for the duration of one call. It is never logged, never returned to
    // the caller, and never written anywhere. Nothing below may print it.
    const origin = siteUrl();
    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
      type: "recovery",
      email: address,
      options: { redirectTo: `${origin}/reset-password` },
    });

    if (linkErr || !link?.properties?.hashed_token) {
      // Code only. The message can carry the address.
      console.error("[requestPasswordReset] link generation failed:", linkErr?.status ?? "unknown");
      return { message: UNIFORM_RESPONSE };
    }

    // Built here rather than using properties.action_link, which points at
    // Supabase's own verify endpoint. Ours goes through /auth/confirm so the
    // token is consumed server-side.
    const actionLink =
      `${origin}/auth/confirm?token_hash=${encodeURIComponent(link.properties.hashed_token)}&type=recovery`;

    try {
      await sendPasswordResetEmail({
        to: address,
        actionLink,
        name: profile.full_name,
        expiresInMinutes: RECOVERY_LINK_MINUTES,
      });
    } catch (mailErr) {
      console.error(
        "[requestPasswordReset] send failed:",
        mailErr instanceof Error ? mailErr.message : "unknown"
      );
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
