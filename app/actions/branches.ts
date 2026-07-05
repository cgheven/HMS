"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { Hostel } from "@/types";

const COOKIE_NAME = "hms_active_hostel";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getAuthedUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) throw new Error("Unauthorized");
  return { supabase, user };
}

// ---------------------------------------------------------------------------
// getOwnedHostels
// ---------------------------------------------------------------------------

export async function getOwnedHostels(): Promise<{
  hostels: (Hostel & { is_primary: boolean })[];
  error?: string;
}> {
  try {
    const { supabase, user } = await getAuthedUser();

    // Try hms_owner_hostels junction first; fall back to legacy owner_id column
    const { data: junctionRows, error: jErr } = await supabase
      .from("hms_owner_hostels")
      .select("hostel_id, is_primary")
      .eq("owner_id", user.id);

    if (jErr || !junctionRows || junctionRows.length === 0) {
      // Legacy fallback — hostels with direct owner_id
      const { data: legacyHostels, error: legacyErr } = await supabase
        .from("hms_hostels")
        .select("*")
        .eq("owner_id", user.id)
        .order("created_at");

      if (legacyErr) return { hostels: [], error: legacyErr.message };

      const hostels = ((legacyHostels ?? []) as Hostel[]).map((h, idx) => ({
        ...h,
        is_primary: idx === 0,
      }));
      return { hostels };
    }

    const hostelIds = junctionRows.map((r) => r.hostel_id);
    const primaryMap = Object.fromEntries(
      junctionRows.map((r) => [r.hostel_id, r.is_primary])
    );

    const { data: hostels, error: hErr } = await supabase
      .from("hms_hostels")
      .select("*")
      .in("id", hostelIds)
      .order("created_at");

    if (hErr) return { hostels: [], error: hErr.message };

    return {
      hostels: ((hostels ?? []) as Hostel[]).map((h) => ({
        ...h,
        is_primary: primaryMap[h.id] ?? false,
      })),
    };
  } catch (e) {
    return { hostels: [], error: (e as Error).message };
  }
}

// ---------------------------------------------------------------------------
// switchActiveHostel
// ---------------------------------------------------------------------------

export async function switchActiveHostel(
  hostelId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await getAuthedUser(); // validates session — throws if unauthenticated

    // Ownership check removed — getAuthContext validates the cookie against owned
    // hostels on every request and falls back to the primary hostel for invalid IDs,
    // so setting an unowned ID here gains nothing and the check added 2 DB queries.
    const cookieStore = await cookies();
    cookieStore.set(COOKIE_NAME, hostelId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: COOKIE_MAX_AGE,
      sameSite: "lax",
    });

    // router.refresh() in the client handles cache invalidation — revalidatePath is redundant here
    return { success: true };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

// ---------------------------------------------------------------------------
// renameBranch
// ---------------------------------------------------------------------------

export async function renameBranch(data: {
  hostelId: string;
  name: string;
  city?: string;
  address?: string;
}): Promise<{ error?: string }> {
  try {
    if (!data.name?.trim()) return { error: "Branch name cannot be empty." };
    const { supabase, user } = await getAuthedUser();

    // Verify ownership
    const { data: owned } = await supabase
      .from("hms_owner_hostels")
      .select("hostel_id")
      .eq("owner_id", user.id)
      .eq("hostel_id", data.hostelId)
      .maybeSingle();

    if (!owned) return { error: "You do not own this branch." };

    const { error } = await supabase
      .from("hms_hostels")
      .update({
        name: data.name.trim(),
        city: data.city?.trim() || null,
        address: data.address?.trim() || null,
      })
      .eq("id", data.hostelId);

    if (error) throw error;
    revalidatePath("/");
    return {};
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// ---------------------------------------------------------------------------
// createBranch
// ---------------------------------------------------------------------------

export async function createBranch(data: {
  name: string;
  city?: string;
  address?: string;
}): Promise<{ hostel?: Hostel; error?: string }> {
  try {
    if (!data.name?.trim()) return { error: "Branch name is required." };

    const { supabase, user } = await getAuthedUser();

    // Insert new hostel
    const { data: newHostel, error: insertErr } = await supabase
      .from("hms_hostels")
      .insert({
        owner_id: user.id,
        name: data.name.trim(),
        city: data.city?.trim() || null,
        address: data.address?.trim() || null,
        total_capacity: 0,
        amenities: [],
        listing_enabled: true,
      })
      .select("*")
      .single();

    if (insertErr) return { error: insertErr.message };

    // Link in junction table (non-primary)
    const { error: jErr } = await supabase.from("hms_owner_hostels").insert({
      owner_id: user.id,
      hostel_id: (newHostel as Hostel).id,
      is_primary: false,
    });

    // Non-fatal if junction insert fails (might not exist yet)
    if (jErr) {
      console.warn("[createBranch] junction insert failed:", jErr.message);
    }

    revalidatePath("/");
    return { hostel: newHostel as Hostel };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
