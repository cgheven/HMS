"use server";

import { headers } from "next/headers";
import { randomBytes, createHash } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeEmail, isDisposableEmailDomain } from "@/lib/email-normalize";
import { EMAIL_RE, PROPERTY_TYPES, PROPERTY_TYPE_MAX_LEN } from "@/lib/validation";
import { siteUrl } from "@/lib/site-url";
import { sendSignupVerificationEmail } from "@/lib/email";
import { isSupportedCountry, DEFAULT_COUNTRY, isManualBankBilling } from "@/lib/country-config";
import { PK_CARD_MONTHLY_USD } from "@/lib/tier-pricing";

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
  // Optional business attribute. One of the presets, or free text (from the
  // "Other" option). Length-capped server-side; never gated on.
  propertyType?: string;
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

    // Property type: accept a known preset verbatim, else treat as custom free
    // text (trim + length-cap). The literal "Other" is the picker sentinel, never
    // a stored value. Empty/absent -> null.
    const rawPropertyType = (input.propertyType ?? "").trim();
    const propertyType =
      !rawPropertyType || rawPropertyType === "Other"
        ? null
        : (PROPERTY_TYPES as readonly string[]).includes(rawPropertyType)
          ? rawPropertyType
          : rawPropertyType.slice(0, PROPERTY_TYPE_MAX_LEN);

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
      // Length-capped (parity with property_type): business_name becomes the
      // starter hostel's public-listing name, so an over-long/garbage value
      // must not reach the directory. Owner name / phone capped for the same
      // abuse-hardening reason.
      business_name: input.businessName?.trim().slice(0, 120) || null,
      owner_name: input.ownerName?.trim().slice(0, 120) || null,
      phone: input.phone?.trim().slice(0, 32) || null,
      country,
      property_type: propertyType,
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
      .select("id, email, business_name, owner_name, phone, country, property_type, expires_at, consumed_at")
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
    // 14-day free trial, no card. NULL for every non-self-serve owner, so only
    // these accounts are trial-gated; the daily cron freezes them (read-only) at
    // expiry unless they subscribe, which clears this (Paddle webhook).
    const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    // A new self-reg owner in a manual-bank country (PK) is put on the Paddle card
    // rail at a per-branch USD rate — the ONLY cohort that gets pk_card_enabled.
    // Existing PK clients keep pk_card_enabled=false (migration 266 default) and
    // stay on manual invoicing. custom_unit_amount_usd carries the per-branch price
    // the checkout math already uses.
    const pkCard = isManualBankBilling(pending.country);
    const [{ error: profErr }, { data: hostData, error: hostErr }] = await Promise.all([
      admin.from("hms_profiles")
        .update({
          country: pending.country,
          full_name: pending.owner_name || null,
          phone: pending.phone || null,
          trial_ends_at: trialEndsAt,
          ...(pkCard ? { pk_card_enabled: true, custom_unit_amount_usd: PK_CARD_MONTHLY_USD } : {}),
        })
        .eq("id", ownerId),
      admin.from("hms_hostels")
        // Public listing ON by default so the owner's /join admission form works
        // immediately (product decision). Trade-off: the branch appears in the
        // public directory before it's set up — the onboarding wizard is where a
        // "go live" gate belongs if we later want listing separate from /join.
        .update({ name: pending.business_name?.trim() || "My Hostel", country: pending.country, listing_enabled: true, property_type: pending.property_type ?? null })
        .eq("owner_id", ownerId)
        .select("id"),
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

    // The profile trigger auto-creates the starter hostel but NOT its pricing
    // config, and the whole app assumes one exists — the payment-amount trigger
    // reads rates from it, and with no row it writes a NULL amount (NOT-NULL
    // violation), so no bill can ever be generated and every active tenant is
    // invisible on the Payments Monthly View. The super-admin onboarding path
    // seeds this row; self-registration must too. Zeroed rates, 30-day notice —
    // the owner sets real numbers in setup. Best-effort: the account is already
    // usable and settings can create it later, so a failure here only logs.
    const newHostelId = (hostData as { id: string }[] | null)?.[0]?.id;
    if (newHostelId) {
      const { error: cfgErr } = await admin.from("hms_package_configs").upsert(
        {
          hostel_id: newHostelId,
          ac_per_unit_rate: 0,
          ac_maintenance_rate: 0,
          security_deposit: 0,
          notice_period_days: 30,
          food_monthly_rate: 0,
          food_breakfast_rate: 0,
          food_lunch_rate: 0,
          food_dinner_rate: 0,
          food_all_meals_rate: 0,
          seater_prices: {},
        },
        { onConflict: "hostel_id", ignoreDuplicates: true }
      );
      if (cfgErr) console.error("[verifySignup] default package config insert failed:", cfgErr.message);
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
