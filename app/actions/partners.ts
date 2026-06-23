"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// ── Guards ────────────────────────────────────────────────────────────────────

async function requireOwnerOrAbove() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("hms_profiles")
    .select("role, is_admin")
    .eq("id", user.id)
    .single();

  // Allow super_admin / owner roles, or legacy is_admin flag
  const allowed =
    profile?.is_admin ||
    profile?.role === "super_admin" ||
    profile?.role === "owner";

  if (!allowed) throw new Error("Forbidden: owner or above required");
  return user;
}

async function verifyOwnsHostel(callerId: string, hostelId: string) {
  const admin = createAdminClient();

  // Check direct ownership
  const { data: directOwner } = await admin
    .from("hms_hostels")
    .select("id")
    .eq("id", hostelId)
    .eq("owner_id", callerId)
    .maybeSingle();

  if (directOwner) return true;

  // Check via junction table
  const { data: junction } = await admin
    .from("hms_owner_hostels")
    .select("id")
    .eq("hostel_id", hostelId)
    .eq("owner_id", callerId)
    .maybeSingle();

  if (junction) return true;

  // Also allow super_admin
  const { data: profile } = await admin
    .from("hms_profiles")
    .select("is_admin, role")
    .eq("id", callerId)
    .maybeSingle();

  return profile?.is_admin || profile?.role === "super_admin";
}

// ── Create Partner ─────────────────────────────────────────────────────────────

export interface PartnerInput {
  name: string;
  email: string;
  phone: string;
  password: string;
}

export interface PartnerResult {
  id?: string;
  name?: string;
  email?: string;
  phone?: string;
  error?: string;
}

export async function createPartner(
  hostelId: string,
  input: PartnerInput
): Promise<PartnerResult> {
  try {
    const caller = await requireOwnerOrAbove();

    if (!input.name?.trim()) throw new Error("Full name is required");
    if (!input.email?.trim()) throw new Error("Email is required");
    if (!input.phone?.trim()) throw new Error("Phone is required");
    if (!input.password || input.password.length < 8)
      throw new Error("Password must be at least 8 characters");
    if (!hostelId) throw new Error("hostelId is required");

    const owns = await verifyOwnsHostel(caller.id, hostelId);
    if (!owns) throw new Error("Forbidden: you do not own this hostel");

    const admin = createAdminClient();

    // Create auth user with confirmed email
    const { data: created, error: createError } =
      await admin.auth.admin.createUser({
        email: input.email.trim(),
        password: input.password,
        email_confirm: true,
        user_metadata: { full_name: input.name.trim() },
      });

    if (createError) throw createError;
    const newUserId = created.user.id;

    // Upsert profile with partner role
    const { error: profileError } = await admin.from("hms_profiles").upsert(
      {
        id: newUserId,
        role: "partner",
        full_name: input.name.trim(),
        phone: input.phone.trim(),
        is_active: true,
      },
      { onConflict: "id" }
    );
    if (profileError) throw profileError;

    // Insert partnership record
    const { error: partnerError } = await admin
      .from("hms_partnerships")
      .insert({
        hostel_id: hostelId,
        partner_id: newUserId,
        created_by: caller.id,
        is_active: true,
      });
    if (partnerError) throw partnerError;

    return {
      id: newUserId,
      name: input.name.trim(),
      email: input.email.trim(),
      phone: input.phone.trim(),
    };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Failed to create partner",
    };
  }
}

// ── List Partners ──────────────────────────────────────────────────────────────

export interface PartnerRow {
  partnership_id: string;
  partner_id: string;
  full_name: string | null;
  email: string;
  phone: string | null;
  is_active: boolean;
  created_at: string;
}

export async function listPartners(
  hostelId: string
): Promise<{ partners?: PartnerRow[]; error?: string }> {
  try {
    const caller = await requireOwnerOrAbove();
    const owns = await verifyOwnsHostel(caller.id, hostelId);
    if (!owns) throw new Error("Forbidden: you do not own this hostel");

    const admin = createAdminClient();

    // Fetch partnerships + profiles
    const { data: partnerships, error: pErr } = await admin
      .from("hms_partnerships")
      .select("id, partner_id, is_active, created_at")
      .eq("hostel_id", hostelId)
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (pErr) throw pErr;
    if (!partnerships || partnerships.length === 0) return { partners: [] };

    const partnerIds = partnerships.map((p) => p.partner_id);

    // Fetch profiles
    const { data: profiles } = await admin
      .from("hms_profiles")
      .select("id, full_name, phone")
      .in("id", partnerIds);

    // Fetch emails from auth
    const emailMap = new Map<string, string>();
    for (const pid of partnerIds) {
      const { data: authUser } = await admin.auth.admin.getUserById(pid);
      if (authUser?.user) emailMap.set(pid, authUser.user.email ?? "");
    }

    const profileMap = new Map(
      (profiles ?? []).map((p) => [p.id, p])
    );

    const partners: PartnerRow[] = partnerships.map((p) => ({
      partnership_id: p.id,
      partner_id: p.partner_id,
      full_name: profileMap.get(p.partner_id)?.full_name ?? null,
      email: emailMap.get(p.partner_id) ?? "",
      phone: profileMap.get(p.partner_id)?.phone ?? null,
      is_active: p.is_active,
      created_at: p.created_at,
    }));

    return { partners };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Failed to list partners",
    };
  }
}

// ── Remove Partner ─────────────────────────────────────────────────────────────

export async function removePartner(
  partnershipId: string
): Promise<{ error?: string }> {
  try {
    const caller = await requireOwnerOrAbove();
    const admin = createAdminClient();

    // Fetch the partnership to verify hostel ownership
    const { data: partnership, error: fetchErr } = await admin
      .from("hms_partnerships")
      .select("hostel_id, partner_id")
      .eq("id", partnershipId)
      .single();

    if (fetchErr || !partnership)
      throw new Error("Partnership not found");

    const owns = await verifyOwnsHostel(caller.id, partnership.hostel_id);
    if (!owns) throw new Error("Forbidden: you do not own this hostel");

    const { error } = await admin
      .from("hms_partnerships")
      .update({ is_active: false })
      .eq("id", partnershipId);

    if (error) throw error;
    return {};
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Failed to remove partner",
    };
  }
}

// ── Get Partner's Hostels (used in partner portal) ────────────────────────────

export interface PartnerHostel {
  hostel_id: string;
  partnership_id: string;
  hostel: {
    id: string;
    name: string;
    city: string | null;
    area: string | null;
    address: string | null;
    phone: string | null;
    total_capacity: number;
  };
}

export async function getPartnerHostels(): Promise<{
  hostels?: PartnerHostel[];
  error?: string;
}> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");

    const admin = createAdminClient();

    const { data, error } = await admin
      .from("hms_partnerships")
      .select(
        "id, hostel_id, hostel:hms_hostels(id, name, city, area, address, phone, total_capacity)"
      )
      .eq("partner_id", user.id)
      .eq("is_active", true);

    if (error) throw error;

    const hostels: PartnerHostel[] = (data ?? []).map((row: any) => ({
      hostel_id: row.hostel_id,
      partnership_id: row.id,
      hostel: row.hostel,
    }));

    return { hostels };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Failed to get partner hostels",
    };
  }
}
