import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientIpFrom } from "@/lib/client-ip";

/** Proof that THIS session came from a recovery link, not from a normal login.
 *  httpOnly so a browser cannot forge it, and short-lived so a stale one cannot
 *  be reused hours later. */
export const RECOVERY_COOKIE = "hms_pw_recovery";
const RECOVERY_COOKIE_MAX_AGE = 15 * 60;

/**
 * Verifies a recovery link and turns it into a session, server-side.
 *
 * This exists so the reset link works on ANY device. The previous design called
 * resetPasswordForEmail, and @supabase/ssr hard-codes flowType "pkce", so the
 * code_verifier was minted in whichever browser submitted the forgot-password
 * form — open the email on a phone and the link was dead. A token_hash verified
 * here carries no per-browser state, so the link works wherever it is opened.
 *
 * The token_hash arrives in the QUERY STRING and is consumed here, on the
 * server. Stated precisely, because the earlier version of this comment
 * overclaimed: the browser DOES navigate to this URL, so the token is briefly
 * in the address bar, in history, and in the platform's access log. What it is
 * never in is a rendered page, a client-readable response, or a Referer header
 * — this route returns a 307 and renders nothing, and the redirect target
 * carries no token. That is still strictly better than the URL fragment it
 * replaces, which lived in the browser for the life of the page.
 */

/** Per hour, per IP, on VERIFICATION attempts.
 *
 *  Not an anti-brute-force control — GoTrue already caps verifies at roughly 30
 *  per 5 minutes per source IP, and a token_hash is not guessable in that
 *  budget. This exists for AVAILABILITY: without it any stranger can spend our
 *  project's entire verification budget with a few dozen junk requests, and
 *  password recovery silently stops working for all 22 users, with the 429
 *  indistinguishable from a bad link.
 *
 *  Deliberately per-IP ONLY. A second, global ceiling was recommended so that
 *  IP rotation could not buy back the space; I did not add one, because it
 *  makes the exact problem it addresses CHEAPER to cause. A global cap is a
 *  switch any single attacker can flip to deny recovery to everyone, at a
 *  threshold lower than GoTrue's own. It moves the outage earlier rather than
 *  preventing it, and buys no security, since nothing here is brute-forceable.
 *  Per-IP raises the bar to needing a proxy pool; a global cap would lower it
 *  to needing one curl loop. */
const VERIFY_IP_HOURLY_LIMIT = 20;
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");

  // Recovery only. This route must never become a general-purpose way to turn a
  // link of any type into a session.
  if (!tokenHash || type !== "recovery") {
    return NextResponse.redirect(`${origin}/reset-password?error=invalid`);
  }

  // Charged BEFORE the verify, unconditionally, and failing closed: an
  // unverifiable ceiling is no ceiling. A refused caller gets the same answer as
  // a forged token, so this adds no oracle.
  try {
    const { data: ok, error } = await createAdminClient().rpc("hms_auth_rate_hit", {
      p_bucket: `pwverify:ip:${clientIpFrom(request.headers)}`,
      p_limit: VERIFY_IP_HOURLY_LIMIT,
    });
    if (error || ok === false) {
      return NextResponse.redirect(`${origin}/reset-password?error=invalid`);
    }
  } catch {
    return NextResponse.redirect(`${origin}/reset-password?error=invalid`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type: "recovery", token_hash: tokenHash });

  if (error) {
    // One answer for expired, already-used and forged. Distinguishing them
    // would tell an attacker which guesses were closer.
    //
    // Not logged. A per-failure log line on an unauthenticated endpoint is a
    // free way for anyone to fill the log, and the status code carries nothing
    // we would act on.
    return NextResponse.redirect(`${origin}/reset-password?error=invalid`);
  }

  // The session cookie is set by the response; the token is not carried forward.
  //
  // The marker below is what stops /reset-password becoming a password-change
  // form for anyone who merely happens to be signed in. A session alone proves
  // a login; only this proves a recovery link was verified, and only this server
  // can set it.
  const res = NextResponse.redirect(`${origin}/reset-password`);
  res.cookies.set(RECOVERY_COOKIE, "1", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: RECOVERY_COOKIE_MAX_AGE,
  });
  return res;
}
