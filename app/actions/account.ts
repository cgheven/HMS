"use server";

import { headers } from "next/headers";
import { randomBytes, createHash } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthContext } from "@/lib/data";
import { normalizeEmail, isDisposableEmailDomain } from "@/lib/email-normalize";
import { EMAIL_RE } from "@/lib/validation";
import { siteUrl } from "@/lib/site-url";
import { sendEmailChangeVerificationEmail } from "@/lib/email";

/**
 * Self-service email change — request step (authenticated).
 *
 * Verify-before-switch: this does NOT change the login email. It writes a pending
 * row + emails a confirmation link to the NEW address; the switch happens only
 * when that token is verified by someone who controls the new inbox
 * (verifyEmailChange). That prevents a typo locking the owner out and stops the
 * account being moved to an address the requester doesn't control.
 */

const LINK_TTL_MINUTES = 60;
const IP_HOURLY_LIMIT = 15;
const USER_HOURLY_LIMIT = 5;

function sha256(v: string): string {
  return createHash("sha256").update(v).digest("hex");
}

// Exact case-insensitive email match via ILIKE: escape LIKE metacharacters so a
// valid address containing `_` or `%` (both allowed by EMAIL_RE) is matched
// literally, not treated as a wildcard (which would falsely report "in use").
function ilikeExact(email: string): string {
  return email.replace(/([\\%_])/g, "\\$1");
}

async function clientIp(): Promise<string> {
  try {
    const h = await headers();
    return (
      h.get("x-vercel-forwarded-for") ||
      h.get("x-real-ip") ||
      h.get("x-forwarded-for")?.split(",").at(-1)?.trim() ||
      "unknown"
    );
  } catch {
    return "unknown";
  }
}

export async function requestEmailChange(newEmailRaw: string): Promise<{ message: string } | { error: string }> {
  // Intentionally NOT requireOwnerOrAbove: this is an account-level self-service
  // action, not a hostel-data write. It acts ONLY on the authenticated caller's own
  // id (never a client-supplied id), so any signed-in role may change THEIR OWN
  // login email — no privilege-escalation surface, and no hostel to resolve. A
  // frozen (unpaid) account is deliberately still allowed: changing the email can't
  // lift a freeze (that keys on the subscription, not the address) and an owner may
  // legitimately need to fix a typo'd address to receive billing mail.
  const ctx = await getAuthContext();
  if (!ctx?.user?.id) return { error: "You must be signed in to change your email." };
  const userId = ctx.user.id;
  const currentEmail = (ctx.user.email ?? ctx.profile?.email ?? "").toLowerCase();
  const isOwner = ctx.profile?.role === "owner";

  if (typeof newEmailRaw !== "string") return { error: "Enter a valid email address." };
  const newEmail = newEmailRaw.trim().toLowerCase();
  if (!newEmail || newEmail.length > 254 || !EMAIL_RE.test(newEmail)) {
    return { error: "Enter a valid email address." };
  }
  if (isDisposableEmailDomain(newEmail)) {
    return { error: "Please use a permanent email address." };
  }
  const normalized = normalizeEmail(newEmail);
  if (normalized === normalizeEmail(currentEmail)) {
    return { error: "That is already your email address." };
  }

  try {
    const admin = createAdminClient();
    const ip = await clientIp();

    // Rate limits — fail closed.
    const { data: ipOk, error: ipErr } = await admin.rpc("hms_auth_rate_hit", {
      p_bucket: `emailchange:ip:${ip}`,
      p_limit: IP_HOURLY_LIMIT,
    });
    if (ipErr || ipOk === false) return { error: "Too many attempts. Please try again shortly." };
    const { data: userOk, error: userErr } = await admin.rpc("hms_auth_rate_hit", {
      p_bucket: `emailchange:user:${userId}`,
      p_limit: USER_HOURLY_LIMIT,
    });
    if (userErr || userOk === false) return { error: "Too many attempts. Please try again shortly." };

    // Friendly pre-check for collisions (the apply step re-checks atomically). An
    // authenticated user changing their own email may be told it's taken — a mild,
    // rate-limited enumeration surface, standard for account-settings flows.
    const { data: exactTaken } = await admin
      .from("hms_profiles").select("id").ilike("email", ilikeExact(newEmail)).neq("id", userId).maybeSingle();
    if (exactTaken) return { error: "That email address is already in use." };
    if (isOwner) {
      const { data: canonTaken } = await admin
        .from("hms_profiles").select("id").eq("normalized_email", normalized).eq("role", "owner").neq("id", userId).maybeSingle();
      if (canonTaken) return { error: "That email address is already in use." };
    }

    const rawToken = randomBytes(32).toString("base64url");
    const tokenHash = sha256(rawToken);
    const expiresAt = new Date(Date.now() + LINK_TTL_MINUTES * 60_000).toISOString();

    // Housekeeping + replace any prior live request for this user (re-request).
    await admin.from("hms_pending_email_changes").delete().lt("expires_at", new Date().toISOString());
    await admin.from("hms_pending_email_changes").delete().eq("user_id", userId).is("consumed_at", null);
    const { error: insErr } = await admin.from("hms_pending_email_changes").insert({
      user_id: userId,
      new_email: newEmail,
      normalized_new_email: normalized,
      token_hash: tokenHash,
      expires_at: expiresAt,
    });
    if (insErr) {
      console.error("[requestEmailChange] insert failed:", insErr.code ?? "unknown");
      return { error: "Something went wrong. Please try again." };
    }

    const actionLink = `${siteUrl()}/auth/verify-email-change?token=${encodeURIComponent(rawToken)}`;
    try {
      await sendEmailChangeVerificationEmail({
        to: newEmail,
        name: ctx.profile?.full_name ?? null,
        actionLink,
        expiresInMinutes: LINK_TTL_MINUTES,
      });
    } catch (mailErr) {
      console.error("[requestEmailChange] send failed:", mailErr instanceof Error ? mailErr.message : "unknown");
      return { error: "We couldn't send the confirmation email. Please try again." };
    }

    return { message: `We've sent a confirmation link to ${newEmail}. Click it to finish changing your email — the link expires in ${LINK_TTL_MINUTES} minutes.` };
  } catch (err) {
    console.error("[requestEmailChange] unexpected:", err instanceof Error ? err.message : "unknown");
    return { error: "Something went wrong. Please try again." };
  }
}

/**
 * Verify step (the token IS the credential; no session needed — the link is
 * clicked from the NEW inbox, possibly in another browser). Switches the login
 * email only after confirming the new address, atomically, with rollback.
 */
export async function verifyEmailChange(token: string): Promise<{ ok: true } | { error: string }> {
  if (typeof token !== "string" || !token) return { error: "This link is invalid or has expired." };

  try {
    const admin = createAdminClient();

    const ip = await clientIp();
    const { data: ipOk, error: ipErr } = await admin.rpc("hms_auth_rate_hit", {
      p_bucket: `verifyemailchange:ip:${ip}`,
      p_limit: 30,
    });
    if (ipErr || ipOk === false) return { error: "Too many attempts. Please try again shortly." };

    const tokenHash = sha256(token.trim());
    const { data: pending, error: lookErr } = await admin
      .from("hms_pending_email_changes")
      .select("id, user_id, new_email, normalized_new_email, expires_at, consumed_at")
      .eq("token_hash", tokenHash)
      .maybeSingle();
    if (lookErr) {
      console.error("[verifyEmailChange] lookup failed:", lookErr.code ?? "unknown");
      return { error: "Something went wrong. Please try again." };
    }
    if (!pending || pending.consumed_at || new Date(pending.expires_at).getTime() < Date.now()) {
      return { error: "This link is invalid or has expired. Please request the change again." };
    }

    // Claim single-use up front so a double-click can't double-apply.
    const { data: claimed, error: claimErr } = await admin
      .from("hms_pending_email_changes")
      .update({ consumed_at: new Date().toISOString() })
      .eq("id", pending.id)
      .is("consumed_at", null)
      .select("id")
      .maybeSingle();
    if (claimErr || !claimed) return { error: "This link has already been used." };

    const unconsume = async () =>
      admin.from("hms_pending_email_changes").update({ consumed_at: null }).eq("id", pending.id);

    // Old email for rollback + role for the canonical re-check.
    const { data: profileRow } = await admin
      .from("hms_profiles").select("email, role").eq("id", pending.user_id).maybeSingle();
    const oldEmail = (profileRow as { email?: string | null } | null)?.email ?? null;
    const isOwner = (profileRow as { role?: string } | null)?.role === "owner";

    // Re-check collisions atomically-close to apply (the profile UPDATE below is
    // the true atomic guard via the owner-scoped unique index; this is a friendly
    // early-out so we don't touch auth for a doomed change).
    const { data: exactTaken } = await admin
      .from("hms_profiles").select("id").ilike("email", ilikeExact(pending.new_email)).neq("id", pending.user_id).maybeSingle();
    if (exactTaken) { await unconsume(); return { error: "That email address is now in use. Please choose another." }; }
    if (isOwner) {
      const { data: canonTaken } = await admin
        .from("hms_profiles").select("id").eq("normalized_email", pending.normalized_new_email).eq("role", "owner").neq("id", pending.user_id).maybeSingle();
      if (canonTaken) { await unconsume(); return { error: "That email address is now in use. Please choose another." }; }
    }

    // Switch the login identity first (its own uniqueness is enforced by Supabase),
    // then mirror onto the profile. If the profile write fails (e.g. the owner-scoped
    // canonical unique index rejects it), roll the auth email back so login and
    // profile never diverge.
    const { error: authErr } = await admin.auth.admin.updateUserById(pending.user_id, {
      email: pending.new_email,
      email_confirm: true,
    });
    if (authErr) {
      await unconsume();
      console.warn("[verifyEmailChange] auth update failed:", authErr.message);
      return { error: "That email address could not be set. Please try again." };
    }

    const { error: profErr } = await admin
      .from("hms_profiles")
      .update({ email: pending.new_email, normalized_email: pending.normalized_new_email })
      .eq("id", pending.user_id);
    if (profErr) {
      console.error("[verifyEmailChange] profile update failed, rolling back auth:", profErr.code ?? "unknown");
      if (oldEmail) {
        const { error: rbErr } = await admin.auth.admin.updateUserById(pending.user_id, { email: oldEmail, email_confirm: true });
        if (rbErr) console.error("[verifyEmailChange] auth rollback failed:", rbErr.message);
      }
      await unconsume();
      return { error: "That email address is already in use. Please choose another." };
    }

    return { ok: true };
  } catch (err) {
    console.error("[verifyEmailChange] unexpected:", err instanceof Error ? err.message : "unknown");
    return { error: "Something went wrong. Please try again." };
  }
}
