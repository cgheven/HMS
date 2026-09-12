"use server";

import { headers } from "next/headers";
import { randomBytes, createHash } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeEmail, isDisposableEmailDomain } from "@/lib/email-normalize";
import { EMAIL_RE } from "@/lib/validation";
import { siteUrl } from "@/lib/site-url";
import { sendSignupVerificationEmail } from "@/lib/email";
import { isSupportedCountry, DEFAULT_COUNTRY } from "@/lib/country-config";

/**
 * Public self-registration — request step (unauthenticated).
 *
 * Deliberately does NOT create an auth user: an unverified signup must never
 * claim the canonical owner-email slot (a pre-registration DoS). It writes a
 * pending row + emails a token; the owner account is created only on verify, by
 * someone who controls the inbox (verifySignupAndProvision).
 *
 * Anti-enumeration: always returns the same message whether or not the address is
 * already registered or was actually mailed — mirrors requestPasswordReset.
 */

const LINK_TTL_MINUTES = 60;
const IP_HOURLY_LIMIT = 15;
const EMAIL_HOURLY_LIMIT = 5;
const UNIFORM_RESPONSE =
  "Check your inbox — if you can sign up with that email, a verification link is on its way.";

function sha256(v: string): string {
  return createHash("sha256").update(v).digest("hex");
}

async function requestContext(): Promise<{ ip: string; country: string }> {
  try {
    const h = await headers();
    const ip =
      h.get("x-vercel-forwarded-for") ||
      h.get("x-real-ip") ||
      h.get("x-forwarded-for")?.split(",").at(-1)?.trim() ||
      "unknown";
    // Vercel sets the requester's country from IP geolocation — a DEFAULT only;
    // the owner confirms/edits it in onboarding, and it's re-validated there.
    const geo = (h.get("x-vercel-ip-country") || "").toUpperCase();
    const country = isSupportedCountry(geo) ? geo : DEFAULT_COUNTRY;
    return { ip, country };
  } catch {
    return { ip: "unknown", country: DEFAULT_COUNTRY };
  }
}

export async function requestSignup(input: {
  businessName?: string;
  ownerName?: string;
  email: string;
  phone?: string;
  // Optional client hint; the server re-derives from IP and only trusts a
  // supported code, so a spoofed value can't unlock an unsupported country.
  country?: string;
  // Honeypot — real users leave it empty; bots fill it. Deliberately NOT named
  // "website"/"url" etc. so aggressive password-manager autofill can't populate
  // it and silently drop a legitimate signup (uniform response hides the loss).
  contactRef2?: string;
}): Promise<{ message: string }> {
  if (typeof input?.email !== "string") return { message: UNIFORM_RESPONSE };
  if (input.contactRef2) return { message: UNIFORM_RESPONSE }; // honeypot tripped

  const email = input.email.trim().toLowerCase();
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) return { message: UNIFORM_RESPONSE };
  if (isDisposableEmailDomain(email)) return { message: UNIFORM_RESPONSE };

  const normalized = normalizeEmail(email);

  try {
    const admin = createAdminClient();
    const { ip, country: ipCountry } = await requestContext();
    const clientCountry = (input.country || "").toUpperCase();
    const country = isSupportedCountry(clientCountry) ? clientCountry : ipCountry;

    // IP ceiling first, unconditionally — fails closed.
    const { data: ipOk, error: ipErr } = await admin.rpc("hms_auth_rate_hit", {
      p_bucket: `signup:ip:${ip}`,
      p_limit: IP_HOURLY_LIMIT,
    });
    if (ipErr || ipOk === false) return { message: UNIFORM_RESPONSE };

    // If a verified OWNER already exists on this canonical email, silently stop
    // (uniform response — don't disclose that the account exists).
    const { data: existingOwner } = await admin
      .from("hms_profiles").select("id").eq("normalized_email", normalized).eq("role", "owner").maybeSingle();
    if (existingOwner) return { message: UNIFORM_RESPONSE };

    // Per-address ceiling, charged only once we're about to mail.
    const { data: emailOk, error: emailErr } = await admin.rpc("hms_auth_rate_hit", {
      p_bucket: `signup:email:${normalized}`,
      p_limit: EMAIL_HOURLY_LIMIT,
    });
    if (emailErr || emailOk === false) return { message: UNIFORM_RESPONSE };

    const rawToken = randomBytes(32).toString("base64url");
    const tokenHash = sha256(rawToken);
    const expiresAt = new Date(Date.now() + LINK_TTL_MINUTES * 60_000).toISOString();

    // Opportunistic housekeeping: drop expired rows so the table can't grow
    // unbounded and old PII doesn't linger (no cron needed).
    await admin.from("hms_pending_signups").delete().lt("expires_at", new Date().toISOString());

    // Replace any prior LIVE pending row for this canonical (re-request), then
    // insert. The partial unique index guards against a concurrent double-insert.
    await admin.from("hms_pending_signups").delete().eq("normalized_email", normalized).is("consumed_at", null);
    const { error: insErr } = await admin.from("hms_pending_signups").insert({
      email,
      normalized_email: normalized,
      business_name: input.businessName?.trim() || null,
      owner_name: input.ownerName?.trim() || null,
      phone: input.phone?.trim() || null,
      country,
      token_hash: tokenHash,
      expires_at: expiresAt,
    });
    if (insErr) {
      console.error("[requestSignup] pending insert failed:", insErr.code ?? "unknown");
      return { message: UNIFORM_RESPONSE };
    }

    const actionLink = `${siteUrl()}/auth/verify-signup?token=${encodeURIComponent(rawToken)}`;
    try {
      await sendSignupVerificationEmail({
        to: email,
        name: input.ownerName?.trim() || null,
        actionLink,
        expiresInMinutes: LINK_TTL_MINUTES,
      });
    } catch (mailErr) {
      console.error("[requestSignup] send failed:", mailErr instanceof Error ? mailErr.message : "unknown");
    }

    return { message: UNIFORM_RESPONSE };
  } catch (err) {
    console.error("[requestSignup] unexpected:", err instanceof Error ? err.message : "unknown");
    return { message: UNIFORM_RESPONSE };
  }
}

/**
 * Verify step (unauthenticated; the token IS the credential). Creates the owner
 * account NOW — the canonical owner slot is claimed atomically by the auth trigger
 * (a concurrent claim fails createUser and rolls back). Returns a set-password
 * recovery link the caller redirects to; the raw signup token is single-use.
 */
export async function verifySignupAndProvision(
  token: string
): Promise<{ actionLink: string } | { error: string }> {
  if (typeof token !== "string" || !token) return { error: "This link is invalid or has expired." };

  try {
    const admin = createAdminClient();

    // Per-IP ceiling (parity with /auth/confirm) — junk-token floods cost one
    // indexed read each; bound them. Fails closed.
    const { ip } = await requestContext();
    const { data: ipOk, error: ipErr } = await admin.rpc("hms_auth_rate_hit", {
      p_bucket: `verifysignup:ip:${ip}`,
      p_limit: 30,
    });
    if (ipErr || ipOk === false) return { error: "Too many attempts. Please try again shortly." };

    const tokenHash = sha256(token.trim());

    const { data: pending, error: lookErr } = await admin
      .from("hms_pending_signups")
      .select("id, email, business_name, owner_name, phone, country, expires_at, consumed_at")
      .eq("token_hash", tokenHash)
      .maybeSingle();
    if (lookErr) {
      console.error("[verifySignup] lookup failed:", lookErr.code ?? "unknown");
      return { error: "Something went wrong. Please try signing up again." };
    }
    if (!pending || pending.consumed_at || new Date(pending.expires_at).getTime() < Date.now()) {
      return { error: "This link is invalid or has expired. Please sign up again." };
    }

    // Claim the pending row up front (single-use) so a double-click can't
    // double-provision; a concurrent verify then sees it consumed.
    const { data: claimed, error: claimErr } = await admin
      .from("hms_pending_signups")
      .update({ consumed_at: new Date().toISOString() })
      .eq("id", pending.id)
      .is("consumed_at", null)
      .select("id")
      .maybeSingle();
    if (claimErr || !claimed) return { error: "This link has already been used. Try signing in." };

    // Create the owner auth user — the trigger claims the canonical owner slot
    // atomically. A collision (someone registered this email meanwhile) surfaces
    // as an error here; the account is not created.
    const { data: created, error: authErr } = await admin.auth.admin.createUser({
      email: pending.email,
      password: `Pulse${randomBytes(18).toString("base64url")}!`, // placeholder; owner sets their own via the link
      email_confirm: true,
      user_metadata: { full_name: pending.owner_name || undefined, phone: pending.phone || undefined },
    });
    if (authErr || !created?.user) {
      console.warn("[verifySignup] createUser failed:", authErr?.message ?? "no user");
      // Un-consume so a transient failure's link stays usable (a genuine canonical
      // collision simply fails again — harmless). Don't reveal which it was.
      await admin.from("hms_pending_signups").update({ consumed_at: null }).eq("id", pending.id);
      return { error: "We couldn't finish creating your account. Please try the link again in a moment, or sign in if you already have an account." };
    }
    const ownerId = created.user.id;

    // Set the account's country + details via the service role (the country guard
    // blocks user sessions, not the admin client). Unpublish the starter hostel the
    // profile trigger auto-created so an empty listing never leaks; stamp its country.
    const [{ error: profErr }, { error: hostErr }] = await Promise.all([
      admin.from("hms_profiles")
        .update({ country: pending.country, full_name: pending.owner_name || null, phone: pending.phone || null })
        .eq("id", ownerId),
      admin.from("hms_hostels")
        .update({ country: pending.country, listing_enabled: false })
        .eq("owner_id", ownerId),
    ]);
    if (profErr || hostErr) {
      // Check BOTH — supabase-js returns {error}, never throws. Roll back rather
      // than leave a half-provisioned account or a mis-countried hostel; free the
      // token so the owner can retry the link. (The starter hostel is already
      // created unlisted by the trigger, so there is no publish window here.)
      console.error("[verifySignup] provision update failed:", profErr?.message ?? hostErr?.message);
      const { error: delErr } = await admin.auth.admin.deleteUser(ownerId);
      if (delErr) console.error("[verifySignup] rollback deleteUser failed:", delErr.message);
      await admin.from("hms_pending_signups").update({ consumed_at: null }).eq("id", pending.id);
      return { error: "Something went wrong creating your account. Please try the link again." };
    }

    // Hand the browser a set-password link (token_hash consumed server-side at
    // /auth/confirm — never in the URL bar), same proven path as password reset.
    const origin = siteUrl();
    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
      type: "recovery",
      email: pending.email,
      options: { redirectTo: `${origin}/reset-password` },
    });
    if (linkErr || !link?.properties?.hashed_token) {
      console.error("[verifySignup] set-password link failed:", linkErr?.status ?? "unknown");
      // Account exists; they can use "forgot password" to set one.
      return { error: "Your account is ready — please use “Forgot password” on the sign-in page to set your password." };
    }
    return {
      actionLink: `${origin}/auth/confirm?token_hash=${encodeURIComponent(link.properties.hashed_token)}&type=recovery`,
    };
  } catch (err) {
    console.error("[verifySignup] unexpected:", err instanceof Error ? err.message : "unknown");
    return { error: "Something went wrong. Please try signing up again." };
  }
}
