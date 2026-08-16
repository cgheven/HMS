/**
 * Shared constants for the password-recovery handshake.
 *
 * These live here rather than in app/auth/confirm/route.ts because a Next.js
 * route module may only export the HTTP verbs plus a fixed set of config fields
 * (dynamic, revalidate, runtime, …). Exporting anything else — even a plain
 * string constant — fails the production build with "not a valid Route export
 * field", which `npx tsc --noEmit` does NOT catch: the route-export rule is
 * enforced by Next's own type validator during `next build`, not by tsc.
 */

/** Proof that a session came from a verified recovery link rather than a normal
 *  login. httpOnly so a browser cannot forge it, and short-lived so a stale one
 *  cannot be reused hours later. */
export const RECOVERY_COOKIE = "hms_pw_recovery";

/** Long enough to choose a password and correct a mismatch, short enough that
 *  walking away from an unlocked machine does not leave a usable window. */
export const RECOVERY_COOKIE_MAX_AGE = 15 * 60;
