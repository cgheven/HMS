"use server";

import { randomBytes } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { writeAuditLog } from "@/lib/audit";
import type { PlatformLead } from "@/types";

// ── Guard ─────────────────────────────────────────────────────────────────────

async function requireSuperAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("hms_profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "super_admin") throw new Error("Forbidden: super_admin access required");
  return user;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SuperAdminStats {
  totalHostels: number;
  totalActiveTenants: number;
  totalRevenueThisMonth: number;
  newLeadsThisMonth: number;
}

export interface SuperHostelRow {
  id: string;
  name: string;
  owner_id: string;
  owner_name: string | null;
  owner_email: string;
  city: string | null;
  address: string | null;
  total_capacity: number;
  tenant_count: number;
  auto_reminder_enabled: boolean;
  created_at: string;
}

// ── getSuperAdminStats ────────────────────────────────────────────────────────

export async function getSuperAdminStats(): Promise<{
  stats?: SuperAdminStats;
  error?: string;
}> {
  try {
    await requireSuperAdmin();
    const admin = createAdminClient();

    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    const [hostelsRes, tenantsRes, revenueRes, leadsRes] = await Promise.all([
      admin.from("hms_hostels").select("id", { count: "exact", head: true }),
      admin.from("hms_tenants").select("id", { count: "exact", head: true }).eq("is_active", true),
      admin
        .from("hms_payments")
        .select("amount")
        .eq("status", "paid")
        .eq("for_month", currentMonthKey),
      admin
        .from("hms_platform_leads")
        .select("id", { count: "exact", head: true })
        .gte("created_at", monthStart),
    ]);

    const totalRevenueThisMonth = (revenueRes.data ?? []).reduce(
      (sum, p) => sum + Number(p.amount),
      0
    );

    return {
      stats: {
        totalHostels: hostelsRes.count ?? 0,
        totalActiveTenants: tenantsRes.count ?? 0,
        totalRevenueThisMonth,
        newLeadsThisMonth: leadsRes.count ?? 0,
      },
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to load stats" };
  }
}

// ── listAllHostels ────────────────────────────────────────────────────────────

export async function listAllHostels(): Promise<{
  hostels?: SuperHostelRow[];
  error?: string;
}> {
  try {
    await requireSuperAdmin();
    const admin = createAdminClient();

    const [hostelsRes, profilesRes, authRes, tenantsRes] = await Promise.all([
      admin.from("hms_hostels").select("*").order("created_at", { ascending: false }),
      admin.from("hms_profiles").select("id, full_name"),
      admin.auth.admin.listUsers({ perPage: 1000 }),
      admin
        .from("hms_tenants")
        .select("hostel_id")
        .eq("is_active", true),
    ]);

    if (hostelsRes.error) throw hostelsRes.error;

    const profileMap = new Map((profilesRes.data ?? []).map((p) => [p.id, p]));
    const authMap = new Map((authRes.data?.users ?? []).map((u) => [u.id, u]));

    // Count active tenants per hostel
    const tenantCountMap = new Map<string, number>();
    for (const t of (tenantsRes.data ?? [])) {
      tenantCountMap.set(t.hostel_id, (tenantCountMap.get(t.hostel_id) ?? 0) + 1);
    }

    const hostels: SuperHostelRow[] = (hostelsRes.data ?? []).map((h) => ({
      id: h.id,
      name: h.name,
      owner_id: h.owner_id,
      owner_name: profileMap.get(h.owner_id)?.full_name ?? null,
      owner_email: authMap.get(h.owner_id)?.email ?? "",
      city: h.city ?? null,
      address: h.address ?? null,
      total_capacity: h.total_capacity,
      tenant_count: tenantCountMap.get(h.id) ?? 0,
      auto_reminder_enabled: h.auto_reminder_enabled ?? false,
      created_at: h.created_at,
    }));

    return { hostels };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to list hostels" };
  }
}

// ── setAutoReminderEnabled ────────────────────────────────────────────────────
// Curated per-branch gate: Wasender auto WhatsApp reminders (per-tenant due
// day, every 3 days if still unpaid) are only ever live for a hostel once
// Super Admin explicitly flips this on — fully automatic otherwise, nothing
// for the owner to configure. Pinned against owner self-grant by a DB trigger
// (migration 106) since RLS alone can't express a column-level restriction.

export async function setAutoReminderEnabled(
  hostelId: string,
  enabled: boolean
): Promise<{ success?: boolean; error?: string }> {
  try {
    const caller = await requireSuperAdmin();
    const admin = createAdminClient();

    const { error } = await admin
      .from("hms_hostels")
      .update({ auto_reminder_enabled: enabled, updated_at: new Date().toISOString() })
      .eq("id", hostelId);
    if (error) throw error;

    await writeAuditLog({
      actor_id: caller.id,
      actor_email: caller.email ?? "",
      action: "super_admin.set_auto_reminder_enabled",
      entity: "hostel",
      entity_id: hostelId,
      meta: { enabled },
    });

    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to update auto-reminder access" };
  }
}

// ── createHostelForClient ─────────────────────────────────────────────────────

export interface BranchInput {
  name: string;
  city?: string;
  address?: string;
}

export async function createHostelForClient(data: {
  ownerEmail: string;
  ownerName: string;
  ownerPhone?: string;
  /** Legacy single-hostel path (used by leads conversion) */
  hostelName?: string;
  city?: string;
  address?: string;
  /** Multi-branch path — takes precedence over hostelName */
  branches?: BranchInput[];
  leadId?: string;
}): Promise<{ hostelIds?: string[]; userId?: string; password?: string; error?: string }> {
  try {
    const caller = await requireSuperAdmin();
    if (!data.ownerEmail) throw new Error("Owner email is required");

    const branches: BranchInput[] =
      data.branches && data.branches.length > 0
        ? data.branches
        : [{ name: data.hostelName ?? "", city: data.city, address: data.address }];

    if (branches.some((b) => !b.name.trim())) {
      throw new Error("Every branch must have a name");
    }

    const admin = createAdminClient();

    // 1. Create auth user
    const tempPassword = `Pulse${randomBytes(12).toString("base64url")}!`;
    const { data: created, error: authErr } = await admin.auth.admin.createUser({
      email: data.ownerEmail,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { full_name: data.ownerName },
    });
    if (authErr) throw authErr;
    const userId = created.user.id;

    // 2. Upsert profile
    await admin.from("hms_profiles").upsert(
      { id: userId, full_name: data.ownerName || null, phone: data.ownerPhone || null, role: "owner", is_active: true },
      { onConflict: "id" }
    );

    // The hms_handle_new_profile trigger auto-creates a "My Hostel" entry when
    // the profile is first inserted. Delete it before we create the real branches.
    // Child table (hms_owner_hostels) must be deleted before parent (hms_hostels) to respect FK constraints.
    await admin.from("hms_owner_hostels").delete().eq("owner_id", userId);
    await admin.from("hms_hostels").delete().eq("owner_id", userId);

    // 3. Create all branches
    const hostelIds: string[] = [];
    for (let i = 0; i < branches.length; i++) {
      const b = branches[i];
      const branchSlug = b.name
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .replace(/\s+/g, "-")
        .replace(/^-+|-+$/g, "") || `hostel-${i}`;
      const { data: hostel, error: hostelErr } = await admin
        .from("hms_hostels")
        .insert({ owner_id: userId, name: b.name, city: b.city || null, address: b.address || null, slug: i === 0 ? branchSlug : `${branchSlug}-${i + 1}`, listing_enabled: true })
        .select("id")
        .single();
      if (hostelErr) throw hostelErr;

      await admin.from("hms_owner_hostels").insert({
        owner_id: userId,
        hostel_id: hostel.id,
        is_primary: i === 0,
      });
      hostelIds.push(hostel.id);
    }

    // 4. Mark lead converted
    if (data.leadId) {
      await admin
        .from("hms_platform_leads")
        .update({ status: "converted", converted_hostel_id: hostelIds[0] })
        .eq("id", data.leadId);
    }

    await writeAuditLog({
      actor_id: caller.id,
      actor_email: caller.email ?? "",
      action: "super_admin.create_hostel_for_client",
      entity: "hostel",
      entity_id: hostelIds[0],
      meta: { owner_email: data.ownerEmail, owner_name: data.ownerName, branch_count: hostelIds.length, lead_id: data.leadId ?? null },
    });

    return { hostelIds, userId, password: tempPassword };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to create hostel for client" };
  }
}

// ── deleteHostel ──────────────────────────────────────────────────────────────

export async function deleteHostel(hostelId: string): Promise<{ error?: string }> {
  try {
    const caller = await requireSuperAdmin();
    const admin = createAdminClient();

    const { count } = await admin
      .from("hms_tenants")
      .select("id", { count: "exact", head: true })
      .eq("hostel_id", hostelId)
      .eq("is_active", true);

    if ((count ?? 0) > 0) {
      return { error: `Cannot delete — this branch has ${count} active tenant(s). Deactivate them first.` };
    }

    await admin.from("hms_owner_hostels").delete().eq("hostel_id", hostelId);
    await admin.from("hms_hostels").delete().eq("id", hostelId);

    await writeAuditLog({
      actor_id: caller.id,
      actor_email: caller.email ?? "",
      action: "super_admin.delete_hostel",
      entity: "hostel",
      entity_id: hostelId,
      meta: {},
    });

    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to delete branch" };
  }
}

// ── deleteClient ──────────────────────────────────────────────────────────────

export async function deleteClient(ownerId: string): Promise<{ error?: string }> {
  try {
    const caller = await requireSuperAdmin();
    const admin = createAdminClient();

    // SECURITY: abort on inner query error instead of silently proceeding with empty hostel list
    const { data: ownerHostels, error: hostelErr } = await admin
      .from("hms_hostels")
      .select("id")
      .eq("owner_id", ownerId);
    if (hostelErr) return { error: "Could not verify tenant status. Please try again." };
    const hostelIds = (ownerHostels ?? []).map((h) => h.id);

    if (hostelIds.length > 0) {
      const { count } = await admin
        .from("hms_tenants")
        .select("id", { count: "exact", head: true })
        .in("hostel_id", hostelIds)
        .eq("is_active", true);
      if ((count ?? 0) > 0) {
        return { error: `Cannot delete — this client has ${count} active tenant(s) across their branches.` };
      }
    }

    await admin.from("hms_owner_hostels").delete().eq("owner_id", ownerId);
    await admin.from("hms_hostels").delete().eq("owner_id", ownerId);
    await admin.auth.admin.deleteUser(ownerId);

    await writeAuditLog({
      actor_id: caller.id,
      actor_email: caller.email ?? "",
      action: "super_admin.delete_client",
      entity: "profile",
      entity_id: ownerId,
      meta: {},
    });

    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to delete client" };
  }
}

// ── addBranchToOwner ──────────────────────────────────────────────────────────

export async function addBranchToOwner(data: {
  ownerId: string;
  name: string;
  city?: string;
  address?: string;
}): Promise<{ hostelId?: string; error?: string }> {
  try {
    const caller = await requireSuperAdmin();
    if (!data.ownerId || !data.name.trim()) throw new Error("Owner and branch name are required");

    const admin = createAdminClient();

    const { data: hostel, error: hostelErr } = await admin
      .from("hms_hostels")
      .insert({ owner_id: data.ownerId, name: data.name, city: data.city || null, address: data.address || null })
      .select("id")
      .single();
    if (hostelErr) throw hostelErr;

    await admin.from("hms_owner_hostels").insert({
      owner_id: data.ownerId,
      hostel_id: hostel.id,
      is_primary: false,
    });

    await writeAuditLog({
      actor_id: caller.id,
      actor_email: caller.email ?? "",
      action: "super_admin.add_branch",
      entity: "hostel",
      entity_id: hostel.id,
      meta: { owner_id: data.ownerId, branch_name: data.name },
    });

    return { hostelId: hostel.id };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to add branch" };
  }
}

// ── getRecentLeads ────────────────────────────────────────────────────────────

export async function getRecentLeads(limit = 10): Promise<{
  leads?: PlatformLead[];
  error?: string;
}> {
  try {
    await requireSuperAdmin();
    const admin = createAdminClient();

    const { data, error } = await admin
      .from("hms_platform_leads")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) throw error;
    return { leads: (data ?? []) as PlatformLead[] };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to list recent leads" };
  }
}
