"use server";
// Server actions for the public-facing website configuration (/website).
//
// "use server" files may only export async functions — a const, object or type
// export here compiles fine and then blows up at runtime, and tsc will not warn
// you. Keep every export an async function.
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { getProfile, requireOwnerOrAbove } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeSubdomain, subdomainError } from "@/lib/subdomain";
import { normalizeFacebook, normalizeInstagram, socialUrl } from "@/lib/social";

// ── Branded subdomain (owner self-service) ────────────────────────────────────
// {label}.hostels.yourpulse.io serves this business's public listing.
//
// Owner-level, so it covers every branch — not a per-branch setting despite
// living on a page with a branch switcher.
//
// ONE TIME ONLY. Once set, an owner cannot change or clear it: the address goes
// onto signs, WhatsApp messages and Google, and a rename silently breaks every
// copy already in the wild. Renaming stays a Super Admin action so there is a
// human in the loop who can weigh that. Enforced here, not just in the UI.
//
// Writes through the service role deliberately. A BEFORE UPDATE trigger
// (migration 155) rejects any change to this column while auth.uid() is set,
// which is what stops an owner claiming a rival's name straight from devtools.
// Service-role connections have a null auth.uid(), so this action is the only
// door — and it checks ownership itself before opening it.

export async function claimMySubdomain(
  subdomain: string
): Promise<{ subdomain?: string; error?: string }> {
  try {
    const profile = await requireOwnerOrAbove();

    const value = normalizeSubdomain(subdomain);
    const reason = subdomainError(value);
    if (reason) return { error: reason };

    const admin = createAdminClient();

    // Re-read rather than trusting anything the browser sent: this is the
    // one-time gate, and it is the only thing standing between a client and a
    // rename that breaks their printed material.
    // subdomain_enabled comes back in the same read as the one-time gate, so
    // the premium check costs no extra round trip. It is read from the DB, not
    // taken from the client: the card is hidden when the flag is off, but a
    // hidden card is not access control (migration 167 also pins the column
    // against browser-side self-grant with a trigger).
    const { data: existing, error: readErr } = await admin
      .from("hms_profiles")
      .select("subdomain, subdomain_enabled")
      .eq("id", profile.id)
      .maybeSingle();
    if (readErr) throw readErr;

    // Checked BEFORE the already-claimed gate on purpose: a client whose access
    // was revoked after claiming should still be told their address is set,
    // not that the feature is locked.
    if (!existing?.subdomain && !existing?.subdomain_enabled) {
      return { error: "Your own web address is a premium add-on. Contact us to enable it for your account." };
    }

    if (existing?.subdomain) {
      return { error: "Your subdomain is already set and cannot be changed. Contact support if it's wrong." };
    }

    const { data: clash } = await admin
      .from("hms_profiles")
      .select("id")
      .eq("subdomain", value)
      .neq("id", profile.id)
      .maybeSingle();
    if (clash) return { error: "That subdomain is already taken. Try another." };

    // Guarded on subdomain IS NULL so two tabs racing can't both claim; the
    // loser updates zero rows rather than overwriting the winner.
    const { data: updated, error } = await admin
      .from("hms_profiles")
      .update({ subdomain: value })
      .eq("id", profile.id)
      .is("subdomain", null)
      .select("subdomain");
    if (error) {
      if (error.code === "23505") return { error: "That subdomain was just taken. Try another." };
      if (error.code === "23514") return { error: "Not a valid subdomain" };
      throw error;
    }
    if (!updated || updated.length === 0) {
      return { error: "Your subdomain is already set and cannot be changed." };
    }

    revalidatePath("/website");
    return { subdomain: value };
  } catch (err) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : "Failed to save subdomain" };
  }
}

// ── Public page branding (trading name) ───────────────────────────────────────
//
// Deliberately NOT requireOwnerOrAbove(): the branding card is visible to
// partners today — the Your Profile card it came out of has never been gated —
// and requireOwnerOrAbove redirect()s to /login rather than throwing, which
// would tear a partner off the page mid-edit. getProfile() keys on the caller's
// OWN id, so a partner writes their own row: exactly the no-op they already get.
//
// Separate writer from saveProfile in Settings, which now names full_name and
// nothing else. Two writers, disjoint column sets — a Settings save and a
// Website save can never clobber each other.
export async function saveWebsiteBranding({
  business_name,
}: {
  business_name: string;
}): Promise<{ success?: boolean; error?: string }> {
  try {
    const profile = await getProfile();
    if (!profile) return { error: "Not signed in" };

    // NULL, not "", so the public page falls back to full_name rather than
    // headlining an empty string.
    const value = business_name.trim() || null;
    if (value && value.length > 80) {
      return { error: "Business name must be 80 characters or less" };
    }

    const admin = createAdminClient();
    // Names business_name and ONLY business_name. Never spread a profile object:
    // every hms_profiles UPDATE fires hms_block_subdomain_self_grant (migration
    // 155), which raises on any subdomain change while auth.uid() is non-null.
    const { error } = await admin
      .from("hms_profiles")
      .update({ business_name: value })
      .eq("id", profile.id);
    if (error) {
      if (error.code === "23514") return { error: "Not a valid business name" };
      throw error;
    }

    revalidatePath("/website");
    return { success: true };
  } catch (err) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : "Failed to save" };
  }
}

// ── Client social handles ─────────────────────────────────────────────────────
export async function saveWebsiteSocials({
  instagram,
  facebook,
}: {
  instagram: string;
  facebook: string;
}): Promise<{ success?: boolean; error?: string }> {
  try {
    // Owner-only: this card is never rendered for partners, so the redirect in
    // requireOwnerOrAbove is unreachable, and the public page reads the branch
    // OWNER's profile row — a partner writing their own would be a silent no-op.
    const profile = await requireOwnerOrAbove();

    const ig = normalizeInstagram(instagram);
    const fb = normalizeFacebook(facebook);

    // Validate the EXACT bytes being written, with a predicate that does not
    // normalize. Re-running instagramError() here would normalize a second time
    // — normalizeInstagram strips one leading '@' per pass, so it is not
    // idempotent — and would declare "@@najam" valid while storing "@najam".
    if (ig && socialUrl("instagram", ig) === null) {
      return { error: "Instagram: paste just the username, not the link." };
    }
    if (fb && socialUrl("facebook", fb) === null) {
      return { error: "Facebook: paste just the page name or id, not the link." };
    }

    const admin = createAdminClient();
    const { error } = await admin
      .from("hms_profiles")
      .update({ instagram_handle: ig || null, facebook_handle: fb || null })
      .eq("id", profile.id);
    if (error) {
      // Unreachable backstop for lib/social.ts ↔ migration 165 drift, mapped the
      // way claimMySubdomain maps its own 23514. Kept in its own writer so a bad
      // handle can never report "invalid business name" or silently discard a
      // business-name edit.
      if (error.code === "23514") {
        return { error: "That handle isn't valid. Paste just the username, not the link." };
      }
      throw error;
    }

    revalidatePath("/website");
    return { success: true };
  } catch (err) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : "Failed to save social links" };
  }
}

// ── Public page appearance ────────────────────────────────────────────────────
//
// The owner's PUBLIC page only. The HMS dashboard is dark for everyone and this
// column is never consulted for it.
//
// Stored as the literal choice rather than as NULL-for-light: NULL and 'light'
// are already indistinguishable to the reader (app/actions/public.ts resolves
// anything that is not exactly 'dark' to light), and recording the choice the
// owner actually made is worth more than re-using NULL to mean two things.
export async function saveWebsitePublicTheme(
  theme: "light" | "dark"
): Promise<{ success?: boolean; error?: string }> {
  try {
    // Owner-only, like the subdomain: this is account-level, not per branch.
    const profile = await requireOwnerOrAbove();

    // The parameter type is erased on the wire, so this check is the only thing
    // between a hand-crafted request and the column. Compare against the literal
    // set — never pass the client's string through because it "looks like" one.
    if (theme !== "light" && theme !== "dark") {
      return { error: "Choose either the light or the dark appearance." };
    }

    const admin = createAdminClient();
    const { error } = await admin
      .from("hms_profiles")
      .update({ public_theme: theme })
      .eq("id", profile.id);
    if (error) {
      if (error.code === "23514") return { error: "That appearance isn't available." };
      throw error;
    }

    revalidatePath("/website");
    return { success: true };
  } catch (err) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : "Failed to save appearance" };
  }
}
