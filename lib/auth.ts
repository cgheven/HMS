import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthContext } from "@/lib/data";
import type { Profile, PartnerTier } from "@/types";

/**
 * Fetch the hms_profiles row for the currently authenticated user.
 * Uses React.cache() so the DB round-trip is deduplicated within one server request.
 */
export const getProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // Use the service-role client to bypass any recursive RLS on hms_profiles
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("hms_profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (error || !data) return null;
  return data as Profile;
});

/**
 * Guard: caller must have role = "super_admin".
 * Redirects to /login on failure.
 * Returns the profile on success so callers don't re-fetch.
 */
export async function requireSuperAdmin(): Promise<Profile> {
  const profile = await getProfile();
  if (!profile || profile.role !== "super_admin") {
    redirect("/login");
  }
  return profile;
}

/**
 * Guard: caller must have role "owner" or "super_admin".
 * Redirects to /login on failure.
 */
export async function requireOwnerOrAbove(): Promise<Profile> {
  const profile = await getProfile();
  if (!profile || !["owner", "super_admin"].includes(profile.role)) {
    redirect("/login");
  }
  return profile;
}

const TIER_RANK: Record<PartnerTier, number> = { read_only: 0, standard: 1, full: 2 };

/**
 * Guard: caller must be "owner"/"super_admin" (unrestricted), or a "partner"
 * whose tier on their active branch meets minTier.
 *
 * Redirects to /login only when the caller isn't authenticated at all, or
 * holds a role with no path to this guard (e.g. manager). An authenticated
 * partner whose tier simply falls short throws a normal Error instead —
 * redirecting would tear them off whatever page/dialog they were on and dump
 * them at /login (which, since they're still logged in, just bounces them
 * to /dashboard with no explanation). A thrown Error is caught by the
 * action's own try/catch and surfaces as a normal, actionable toast.
 */
export async function requireOwnerOrPartnerTier(minTier: PartnerTier): Promise<Profile> {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (["owner", "super_admin"].includes(profile.role)) return profile;
  if (profile.role === "partner") {
    const ctx = await getAuthContext(); // cache()-deduped — already resolved this request
    if (ctx?.partnerTier && TIER_RANK[ctx.partnerTier] >= TIER_RANK[minTier]) return profile;
    throw new Error("Your access level does not permit this action.");
  }
  redirect("/login");
}

/**
 * Read the "hms_active_hostel" cookie, validate it against hms_owner_hostels
 * for the current user, and return the hostelId (or null if invalid / missing).
 */
export async function getActiveHostelId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const cookieStore = await cookies();
  // F-010: was "hms-active-hostel" (hyphen) — corrected to "hms_active_hostel"
  // (underscore) to match what switchActiveHostel() in branches.ts sets.
  const cookieVal = cookieStore.get("hms_active_hostel")?.value ?? null;
  if (!cookieVal) return null;

  // Validate the cookie value against the owner-hostel junction table
  const admin = createAdminClient();
  const { data } = await admin
    .from("hms_owner_hostels")
    .select("hostel_id")
    .eq("owner_id", user.id)
    .eq("hostel_id", cookieVal)
    .maybeSingle();

  return data?.hostel_id ?? null;
}

/**
 * Return all hostels owned by the currently authenticated user
 * (joined through hms_owner_hostels).
 */
export async function getOwnedHostels() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const admin = createAdminClient();
  const { data } = await admin
    .from("hms_owner_hostels")
    .select("hostel_id, hms_hostels(*)")
    .eq("owner_id", user.id);

  if (!data) return [];

  // Flatten the joined hostel rows
  return data
    .map((row: { hostel_id: string; hms_hostels: unknown }) => row.hms_hostels)
    .filter(Boolean);
}
