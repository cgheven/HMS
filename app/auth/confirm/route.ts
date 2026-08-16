import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

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
 * server. It therefore never reaches the browser at all: not in the address
 * bar, not in history, and not in a Referer header on any asset the page loads.
 * That is strictly better than the fragment it replaces.
 *
 * On success this redirects WITHOUT the token, so the URL the user ends up on
 * carries nothing sensitive.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");

  // Recovery only. This route must never become a general-purpose way to turn a
  // link of any type into a session.
  if (!tokenHash || type !== "recovery") {
    return NextResponse.redirect(`${origin}/reset-password?error=invalid`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type: "recovery", token_hash: tokenHash });

  if (error) {
    // One answer for expired, already-used and forged. Distinguishing them
    // would tell an attacker which guesses were closer.
    console.warn("[auth/confirm] recovery verification failed:", error.status ?? "unknown");
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
