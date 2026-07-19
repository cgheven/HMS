"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { PartnerTier } from "@/types";

const VALID_TIERS = new Set<PartnerTier>(["read_only", "standard", "full"]);

// Postgres/Postgrest errors (thrown via `throw someError` from a Supabase
// `{ data, error }` response) are plain objects with a `.message`, not real
// Error instances — `err instanceof Error` misses them and masks the actual
// cause behind a generic fallback string. This checks both shapes.
function getErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err && typeof (err as { message: unknown }).message === "string") {
    return (err as { message: string }).message;
  }
  return fallback;
}

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

  const allowed =
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

async function getOwnerHostelIds(callerId: string): Promise<string[]> {
  const admin = createAdminClient();
  const [{ data: direct }, { data: junction }] = await Promise.all([
    admin.from("hms_hostels").select("id").eq("owner_id", callerId),
    admin.from("hms_owner_hostels").select("hostel_id").eq("owner_id", callerId),
  ]);
  const ids = new Set<string>();
  (direct ?? []).forEach((h) => ids.add(h.id));
  (junction ?? []).forEach((j) => ids.add(j.hostel_id));
  return Array.from(ids);
}

// ── Create Partner ─────────────────────────────────────────────────────────────

export interface PartnerInput {
  name: string;
  email: string;
  phone: string;
  password: string;
  tier: PartnerTier;
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
    if (!VALID_TIERS.has(input.tier)) throw new Error("Invalid tier");

    const owns = await verifyOwnsHostel(caller.id, hostelId);
    if (!owns) throw new Error("Forbidden: you do not own this hostel");

    const admin = createAdminClient();

    // removePartner only soft-deletes the hms_partnerships row — the auth user
    // and hms_profiles row are left in place (deliberately: they may still be
    // linked to other branches). Re-adding the same email must therefore reuse
    // that account instead of calling createUser, which rejects duplicate
    // emails outright.
    const { data: existingProfile } = await admin
      .from("hms_profiles")
      .select("id, role")
      .eq("email", input.email.trim())
      .maybeSingle();

    let newUserId: string;

    if (existingProfile) {
      if (existingProfile.role !== "partner") {
        throw new Error("This email is already registered to a different type of account.");
      }
      newUserId = existingProfile.id;
      const { error: updateError } = await admin.auth.admin.updateUserById(newUserId, {
        password: input.password,
        user_metadata: { full_name: input.name.trim(), phone: input.phone.trim(), role: "partner" },
      });
      if (updateError) throw updateError;
    } else {
      // Create auth user with confirmed email. role: "partner" in user_metadata
      // is read by the hms_handle_new_user trigger (AFTER INSERT ON auth.users)
      // so the auto-created hms_profiles row gets the right role from the start —
      // updating role after the fact would hit hms_block_role_escalation, which
      // rejects any role change from a caller that isn't a super_admin (and the
      // service-role admin client has no auth.uid(), so it can never pass that check).
      const { data: created, error: createError } =
        await admin.auth.admin.createUser({
          email: input.email.trim(),
          password: input.password,
          email_confirm: true,
          user_metadata: { full_name: input.name.trim(), phone: input.phone.trim(), role: "partner" },
        });

      if (createError) throw createError;
      newUserId = created.user.id;
    }

    // Fill in anything the trigger's INSERT didn't cover — role is already
    // correct from user_metadata above, so it's deliberately omitted here.
    // `email` MUST be included even though the trigger already set it: Postgres
    // validates NOT NULL constraints on the proposed row before it ever checks
    // for a conflict, so omitting a NOT NULL column with no default (email has
    // none) throws immediately regardless of whether the row already exists —
    // this was a real, separate bug from the role-escalation one, present since
    // this action was first written, that the earlier fix didn't cover.
    const { error: profileError } = await admin.from("hms_profiles").upsert(
      {
        id: newUserId,
        email: input.email.trim(),
        full_name: input.name.trim(),
        phone: input.phone.trim(),
        is_active: true,
      },
      { onConflict: "id" }
    );
    if (profileError) throw profileError;

    // Upsert (not insert) so re-adding a partner previously removed from this
    // same branch reactivates the existing row instead of hitting the
    // hostel_id+partner_id unique constraint.
    const { error: partnerError } = await admin
      .from("hms_partnerships")
      .upsert(
        {
          hostel_id: hostelId,
          partner_id: newUserId,
          created_by: caller.id,
          is_active: true,
          tier: input.tier,
        },
        { onConflict: "hostel_id,partner_id" }
      );
    if (partnerError) throw partnerError;

    return {
      id: newUserId,
      name: input.name.trim(),
      email: input.email.trim(),
      phone: input.phone.trim(),
    };
  } catch (err) {
    return {
      error: getErrorMessage(err, "Failed to create partner"),
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
  tier: PartnerTier;
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
      .select("id, partner_id, is_active, created_at, tier")
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

    // Fetch emails from auth in parallel — avoids O(N × auth-latency) serial loop
    const emailMap = new Map<string, string>();
    await Promise.all(
      partnerIds.map(async (pid) => {
        const { data: authUser } = await admin.auth.admin.getUserById(pid);
        if (authUser?.user) emailMap.set(pid, authUser.user.email ?? "");
      })
    );

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
      tier: p.tier as PartnerTier,
    }));

    return { partners };
  } catch (err) {
    return {
      error: getErrorMessage(err, "Failed to list partners"),
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
      error: getErrorMessage(err, "Failed to remove partner"),
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
      error: getErrorMessage(err, "Failed to get partner hostels"),
    };
  }
}

// ── Update Partner Tier ────────────────────────────────────────────────────────

export async function updatePartnerTier(
  partnershipId: string,
  tier: PartnerTier
): Promise<{ error?: string }> {
  try {
    const caller = await requireOwnerOrAbove();
    if (!VALID_TIERS.has(tier)) throw new Error("Invalid tier");

    const admin = createAdminClient();

    const { data: partnership, error: fetchErr } = await admin
      .from("hms_partnerships")
      .select("hostel_id")
      .eq("id", partnershipId)
      .single();

    if (fetchErr || !partnership) throw new Error("Partnership not found");

    const owns = await verifyOwnsHostel(caller.id, partnership.hostel_id);
    if (!owns) throw new Error("Forbidden: you do not own this hostel");

    const { error } = await admin
      .from("hms_partnerships")
      .update({ tier })
      .eq("id", partnershipId);

    if (error) throw error;
    return {};
  } catch (err) {
    return {
      error: getErrorMessage(err, "Failed to update partner tier"),
    };
  }
}

// ── Existing partners across an owner's other branches ────────────────────────
// Lets the owner attach a partner already active on one of their branches to
// another branch, without a cross-owner email search (which would leak which
// emails belong to partner accounts owned by other people).

export interface ExistingPartnerOption {
  partnerId: string;
  name: string;
  email: string;
  linkedHostelNames: string[];
}

export async function getExistingPartnersForOwner(
  excludeHostelId: string
): Promise<{ partners?: ExistingPartnerOption[]; error?: string }> {
  try {
    const caller = await requireOwnerOrAbove();
    const admin = createAdminClient();

    const ownerHostelIds = await getOwnerHostelIds(caller.id);
    const otherHostelIds = ownerHostelIds.filter((id) => id !== excludeHostelId);
    if (otherHostelIds.length === 0) return { partners: [] };

    const { data: rows, error } = await admin
      .from("hms_partnerships")
      .select("partner_id, hostel:hms_hostels(name)")
      .in("hostel_id", otherHostelIds)
      .eq("is_active", true);

    if (error) throw error;

    const linkedHostels = new Map<string, Set<string>>();
    for (const r of (rows ?? []) as any[]) {
      const set = linkedHostels.get(r.partner_id) ?? new Set<string>();
      set.add(r.hostel?.name ?? "Unknown");
      linkedHostels.set(r.partner_id, set);
    }

    const partnerIds = Array.from(linkedHostels.keys());
    if (partnerIds.length === 0) return { partners: [] };

    const [{ data: profiles }] = await Promise.all([
      admin.from("hms_profiles").select("id, full_name").in("id", partnerIds),
    ]);

    // Emails fetched in parallel — avoids O(N × auth-latency) serial loop
    const emailMap = new Map<string, string>();
    await Promise.all(
      partnerIds.map(async (pid) => {
        const { data: authUser } = await admin.auth.admin.getUserById(pid);
        if (authUser?.user) emailMap.set(pid, authUser.user.email ?? "");
      })
    );

    const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));

    const partners: ExistingPartnerOption[] = partnerIds.map((pid) => ({
      partnerId: pid,
      name: profileMap.get(pid)?.full_name ?? "Unknown",
      email: emailMap.get(pid) ?? "",
      linkedHostelNames: Array.from(linkedHostels.get(pid) ?? []),
    }));

    return { partners };
  } catch (err) {
    return {
      error: getErrorMessage(err, "Failed to load existing partners"),
    };
  }
}

// ── Attach an existing partner to another branch ───────────────────────────────

export async function addPartnerToHostel(
  partnerId: string,
  hostelId: string,
  tier: PartnerTier
): Promise<{ error?: string }> {
  try {
    const caller = await requireOwnerOrAbove();
    if (!VALID_TIERS.has(tier)) throw new Error("Invalid tier");

    const owns = await verifyOwnsHostel(caller.id, hostelId);
    if (!owns) throw new Error("Forbidden: you do not own this hostel");

    const admin = createAdminClient();

    // Defense-in-depth: verify partnerId is really an active partner on at
    // least one of this owner's OTHER hostels, not an arbitrary user id.
    const ownerHostelIds = await getOwnerHostelIds(caller.id);
    const { data: existingLink } = await admin
      .from("hms_partnerships")
      .select("id")
      .eq("partner_id", partnerId)
      .in("hostel_id", ownerHostelIds)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (!existingLink) throw new Error("This partner is not linked to any of your branches.");

    // Upsert so re-adding a previously-removed (soft-deleted) partner to the
    // same branch works too, instead of failing on the unique constraint.
    const { error } = await admin
      .from("hms_partnerships")
      .upsert(
        { hostel_id: hostelId, partner_id: partnerId, created_by: caller.id, is_active: true, tier },
        { onConflict: "hostel_id,partner_id" }
      );

    if (error) throw error;
    return {};
  } catch (err) {
    return {
      error: getErrorMessage(err, "Failed to add partner to branch"),
    };
  }
}
