"use server";
import { getProfile } from "@/lib/auth";

import { randomBytes } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { writeAuditLog } from "@/lib/audit";
import { pktTodayDateString } from "@/lib/pkt-time";
import { isTestOwner } from "@/lib/test-accounts";
import { normalizeSubdomain, subdomainError } from "@/lib/subdomain";
import type { GrowthBranchRow, GrowthTotals } from "@/types";

// ── Guard ─────────────────────────────────────────────────────────────────────

/**
 * Delegates to lib/auth's cache()d getProfile instead of re-authenticating.
 *
 * This file used to run its own getUser() + profile SELECT. So did four other
 * action files and the super-admin layout — six uncached copies of the same two
 * round trips. One Dashboard render performed the identical auth check three to
 * four times, and with functions in us-east and Postgres in Singapore each of
 * those round trips cost ~264ms.
 *
 * Deliberately keeps THROWING rather than calling lib/auth's requireSuperAdmin,
 * which redirects: these are server actions whose callers catch the error and
 * surface it in the UI, and a redirect() thrown inside those catch blocks would
 * be swallowed as a generic failure.
 */
async function requireSuperAdmin() {
  const profile = await getProfile();
  if (!profile) throw new Error("Unauthorized");
  if (profile.role !== "super_admin") throw new Error("Forbidden: super_admin access required");
  return profile;
}

// ── Types ─────────────────────────────────────────────────────────────────────

// Pulse's OWN money, not the rent flowing through the platform. Every figure
// here comes from hms_platform_invoices / hms_client_billing — what clients owe
// us for using the product. Test accounts are excluded throughout (see
// lib/test-accounts.ts) so the headline numbers describe the real business.
export interface SuperAdminStats {
  /** Sum of invoices marked paid, all time. */
  collected: number;
  /** Sum of unpaid invoices. */
  outstanding: number;
  /** Portion of `outstanding` already past its due date. */
  overdue: number;
  /** Contracted monthly recurring revenue: per-branch rate × branches, annual cycles normalised to a month. */
  mrr: number;
  /** Real clients (owners), test accounts excluded. */
  totalClients: number;
  /** Clients with no row in hms_client_billing — using the product for free. */
  unbilledClients: number;
  totalBranches: number;
  totalActiveTenants: number;
}

export interface ClientBranchRow {
  id: string;
  name: string;
  city: string | null;
  hostel_type: string | null;
  tenant_count: number;
}

export interface ClientSummaryRow {
  owner_id: string;
  owner_name: string | null;
  owner_email: string;
  branch_count: number;
  tenant_count: number;
  /** null when this client has no billing configured yet. */
  monthly_rate: number | null;
  outstanding: number;
  branches: ClientBranchRow[];
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
  whatsapp_enabled: boolean;
  /** Per-branch grant for tenant referral links (/marketing). */
  referral_enabled: boolean;
  /** false = excluded from the branch count on new platform invoices. Super Admin only; invisible to the client. */
  billing_active: boolean;
  /**
   * Pulse's cut of a converted referral, per branch. NULL = inherit the platform
   * default; 0 = this branch is charged nothing. Never collapse the two.
   */
  pulse_commission_percent: number | null;
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

    const [ownersRes, hostelsRes, tenantsRes, invoicesRes, billingRes] = await Promise.all([
      admin.from("hms_profiles").select("id").eq("role", "owner"),
      admin.from("hms_hostels").select("id, owner_id"),
      admin.from("hms_tenants").select("hostel_id").eq("is_active", true),
      admin.from("hms_platform_invoices").select("owner_id, amount, status, due_date"),
      admin.from("hms_client_billing").select("owner_id, monthly_rate, billing_cycle"),
    ]);

    const realOwners = (ownersRes.data ?? []).filter((o) => !isTestOwner(o.id));
    const realOwnerIds = new Set(realOwners.map((o) => o.id));

    const realHostels = (hostelsRes.data ?? []).filter((h) => realOwnerIds.has(h.owner_id));
    const realHostelIds = new Set(realHostels.map((h) => h.id));

    const totalActiveTenants = (tenantsRes.data ?? []).filter((t) =>
      realHostelIds.has(t.hostel_id)
    ).length;

    // Pakistan-anchored — a Vercel function runs in UTC and would otherwise
    // call an invoice overdue up to five hours early.
    const today = pktTodayDateString();

    let collected = 0;
    let outstanding = 0;
    let overdue = 0;
    for (const inv of invoicesRes.data ?? []) {
      if (!realOwnerIds.has(inv.owner_id)) continue;
      const amount = Number(inv.amount);
      if (inv.status === "paid") {
        collected += amount;
      } else {
        outstanding += amount;
        if (inv.due_date && inv.due_date < today) overdue += amount;
      }
    }

    // monthly_rate is PER BRANCH (see lib/invoice-generation.ts), so MRR has to
    // multiply by how many branches that client actually runs. An annual client
    // is normalised to a month so one number compares across both cycles.
    const branchesPerOwner = new Map<string, number>();
    for (const h of realHostels) {
      branchesPerOwner.set(h.owner_id, (branchesPerOwner.get(h.owner_id) ?? 0) + 1);
    }

    let mrr = 0;
    let billedOwners = 0;
    for (const b of billingRes.data ?? []) {
      if (!realOwnerIds.has(b.owner_id)) continue;
      billedOwners++;
      mrr += Number(b.monthly_rate) * (branchesPerOwner.get(b.owner_id) ?? 1);
    }

    return {
      stats: {
        collected,
        outstanding,
        overdue,
        mrr,
        totalClients: realOwners.length,
        unbilledClients: Math.max(0, realOwners.length - billedOwners),
        totalBranches: realHostels.length,
        totalActiveTenants,
      },
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to load stats" };
  }
}

// ── getClientSummaries ────────────────────────────────────────────────────────
// One row per CLIENT, not per branch — the old "Hostels Summary" listed branches
// in creation order, so a two-branch business appeared twice with its name
// truncated and no way to tell the rows belonged together.

export async function getClientSummaries(): Promise<{
  clients?: ClientSummaryRow[];
  error?: string;
}> {
  try {
    await requireSuperAdmin();
    const admin = createAdminClient();

    const [profilesRes, authRes, hostelsRes, tenantsRes, billingRes, invoicesRes] =
      await Promise.all([
        admin.from("hms_profiles").select("id, full_name").eq("role", "owner"),
        admin.auth.admin.listUsers({ perPage: 1000 }),
        admin.from("hms_hostels").select("id, owner_id, name, city, hostel_type").order("name"),
        admin.from("hms_tenants").select("hostel_id").eq("is_active", true),
        admin.from("hms_client_billing").select("owner_id, monthly_rate"),
        admin.from("hms_platform_invoices").select("owner_id, amount, status"),
      ]);

    if (profilesRes.error) throw profilesRes.error;

    const owners = (profilesRes.data ?? []).filter((p) => !isTestOwner(p.id));
    const authMap = new Map((authRes.data?.users ?? []).map((u) => [u.id, u]));

    const tenantsPerHostel = new Map<string, number>();
    for (const t of tenantsRes.data ?? []) {
      tenantsPerHostel.set(t.hostel_id, (tenantsPerHostel.get(t.hostel_id) ?? 0) + 1);
    }

    const rateByOwner = new Map(
      (billingRes.data ?? []).map((b) => [b.owner_id, Number(b.monthly_rate)])
    );

    const outstandingByOwner = new Map<string, number>();
    for (const inv of invoicesRes.data ?? []) {
      if (inv.status === "paid") continue;
      outstandingByOwner.set(
        inv.owner_id,
        (outstandingByOwner.get(inv.owner_id) ?? 0) + Number(inv.amount)
      );
    }

    const branchesByOwner = new Map<string, ClientBranchRow[]>();
    for (const h of hostelsRes.data ?? []) {
      const list = branchesByOwner.get(h.owner_id) ?? [];
      list.push({
        id: h.id,
        name: h.name,
        city: h.city ?? null,
        hostel_type: h.hostel_type ?? null,
        tenant_count: tenantsPerHostel.get(h.id) ?? 0,
      });
      branchesByOwner.set(h.owner_id, list);
    }

    const clients: ClientSummaryRow[] = owners.map((o) => {
      const branches = branchesByOwner.get(o.id) ?? [];
      return {
        owner_id: o.id,
        owner_name: o.full_name ?? null,
        owner_email: authMap.get(o.id)?.email ?? "",
        branch_count: branches.length,
        tenant_count: branches.reduce((sum, b) => sum + b.tenant_count, 0),
        monthly_rate: rateByOwner.get(o.id) ?? null,
        outstanding: outstandingByOwner.get(o.id) ?? 0,
        branches,
      };
    });

    // Biggest clients first — tenant count is the best proxy for how much of the
    // platform a client actually uses.
    clients.sort((a, b) => b.tenant_count - a.tenant_count);

    return { clients };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to load clients" };
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
      whatsapp_enabled: h.whatsapp_enabled ?? false,
      referral_enabled: h.referral_enabled ?? false,
      billing_active: h.billing_active ?? true,
      pulse_commission_percent: h.pulse_commission_percent ?? null,
      created_at: h.created_at,
    }));

    return { hostels };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to list hostels" };
  }
}

// ── setWhatsappEnabled ────────────────────────────────────────────────────────
// Curated per-branch gate: WhatsApp automation — auto payment reminders
// (per-tenant due day, every 3 days if still unpaid) AND announcement
// broadcasts — is only ever live for a hostel once Super Admin explicitly
// flips this on. Sold/granted as one package, not two separate flags: a
// hostel doesn't buy reminders and announcements separately. Pinned against
// owner self-grant by a DB trigger (migration 110) since RLS alone can't
// express a column-level restriction.

/**
 * Pause or resume a branch for PLATFORM BILLING only (migration 162).
 *
 * Changes nothing the client can see or use — the branch keeps working exactly
 * as before. It only stops being counted when the next platform invoice is
 * generated. Invoices already issued snapshot branch_count, so past bills are
 * untouched either way.
 *
 * Audit-logged like every other Super Admin money action: this changes what a
 * client is charged, so it needs to be answerable later.
 */
export async function setBranchBillingActive(
  hostelId: string,
  active: boolean
): Promise<{ success?: boolean; error?: string }> {
  try {
    const caller = await requireSuperAdmin();
    const admin = createAdminClient();

    const { error } = await admin
      .from("hms_hostels")
      .update({ billing_active: active, updated_at: new Date().toISOString() })
      .eq("id", hostelId);
    if (error) throw error;

    await writeAuditLog({
      actor_id: caller.id,
      actor_email: caller.email ?? "",
      action: "super_admin.set_branch_billing_active",
      entity: "hostel",
      entity_id: hostelId,
      meta: { active },
    });

    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to update branch billing" };
  }
}

export async function setWhatsappEnabled(
  hostelId: string,
  enabled: boolean
): Promise<{ success?: boolean; error?: string }> {
  try {
    const caller = await requireSuperAdmin();
    const admin = createAdminClient();

    const { error } = await admin
      .from("hms_hostels")
      .update({ whatsapp_enabled: enabled, updated_at: new Date().toISOString() })
      .eq("id", hostelId);
    if (error) throw error;

    await writeAuditLog({
      actor_id: caller.id,
      actor_email: caller.email ?? "",
      action: "super_admin.set_whatsapp_enabled",
      entity: "hostel",
      entity_id: hostelId,
      meta: { enabled },
    });

    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to update WhatsApp access" };
  }
}

// ── setReferralEnabled ────────────────────────────────────────────────────────
// Same shape and same reasoning as setWhatsappEnabled above: a curated
// per-branch grant, pinned against owner self-grant by a DB trigger (migration
// 173) because RLS cannot express a column-level restriction. Off for every
// branch until Super Admin flips it, which is what keeps this feature invisible
// to all 16 clients until it is deliberately handed to one.

export async function setReferralEnabled(
  hostelId: string,
  enabled: boolean
): Promise<{ success?: boolean; error?: string }> {
  try {
    const caller = await requireSuperAdmin();
    const admin = createAdminClient();

    const { error } = await admin
      .from("hms_hostels")
      .update({ referral_enabled: enabled, updated_at: new Date().toISOString() })
      .eq("id", hostelId);
    if (error) throw error;

    await writeAuditLog({
      actor_id: caller.id,
      actor_email: caller.email ?? "",
      action: "super_admin.set_referral_enabled",
      entity: "hostel",
      entity_id: hostelId,
      meta: { enabled },
    });

    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to update referral access" };
  }
}

// ── Pulse referral commission ─────────────────────────────────────────────────
// Pulse charges a ONE-TIME fee of N% of the referred tenant's first month rent
// when a referral converts (migration 187). N is the platform default, optionally
// overridden per branch. Writes go through createAdminClient() because a DB
// trigger rejects any change to these columns made with auth.uid() set — an owner
// must never be able to price Pulse's own revenue.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Arguments to a "use server" module are attacker-controlled: a float, NaN, or a
// numeric string would otherwise reach the DB and either round oddly or trip the
// CHECK constraint with an unreadable Postgres error.
function assertCommissionPercent(percent: unknown): number {
  if (typeof percent !== "number" || !Number.isInteger(percent) || percent < 0 || percent > 100) {
    throw new Error("Commission must be a whole number between 0 and 100");
  }
  return percent;
}

function assertHostelId(hostelId: unknown): string {
  if (typeof hostelId !== "string" || !UUID_RE.test(hostelId)) throw new Error("Invalid branch");
  return hostelId;
}

export async function getPlatformCommissionPercent(): Promise<{
  percent?: number;
  error?: string;
}> {
  try {
    await requireSuperAdmin();
    const admin = createAdminClient();

    const { data, error } = await admin
      .from("hms_platform_settings")
      .select("referral_commission_percent")
      .eq("id", true)
      .maybeSingle();
    if (error) throw error;

    // Mirrors hms_pulse_commission_percent()'s final coalesce: with no settings
    // row nothing is charged, so reporting 15 here would be a lie about billing.
    return { percent: data?.referral_commission_percent ?? 0 };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to load commission rate" };
  }
}

/**
 * Changes what EVERY branch without its own override is charged.
 * Upserted rather than updated so the single row is created if it is ever missing;
 * `id` is a boolean CHECKed to true, so there can only ever be one.
 */
export async function setPlatformCommissionPercent(
  percent: number
): Promise<{ success?: boolean; error?: string }> {
  try {
    const caller = await requireSuperAdmin();
    const pct = assertCommissionPercent(percent);
    const admin = createAdminClient();

    // updated_at is owned by the hms_platform_settings_updated_at trigger.
    const { error } = await admin
      .from("hms_platform_settings")
      .upsert({ id: true, referral_commission_percent: pct }, { onConflict: "id" });
    if (error) throw error;

    await writeAuditLog({
      actor_id: caller.id,
      actor_email: caller.email ?? "",
      action: "super_admin.set_platform_commission_percent",
      entity: "platform_settings",
      meta: { percent: pct },
    });

    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to update platform commission" };
  }
}

/** `null` clears the override so the branch inherits the platform default again. */
export async function setHostelCommissionPercent(
  hostelId: string,
  percent: number | null
): Promise<{ success?: boolean; error?: string }> {
  try {
    const caller = await requireSuperAdmin();
    const id = assertHostelId(hostelId);
    const pct = percent === null ? null : assertCommissionPercent(percent);
    const admin = createAdminClient();

    const { error } = await admin
      .from("hms_hostels")
      .update({ pulse_commission_percent: pct, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;

    await writeAuditLog({
      actor_id: caller.id,
      actor_email: caller.email ?? "",
      action: "super_admin.set_hostel_commission_percent",
      entity: "hostel",
      entity_id: id,
      meta: { percent: pct, inherits_default: pct === null },
    });

    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to update branch commission" };
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
      const { data: hostel, error: hostelErr } = await admin
        .from("hms_hostels")
        .insert({ owner_id: userId, name: b.name, city: b.city || null, address: b.address || null, listing_enabled: true })
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

// ── Branded subdomains ────────────────────────────────────────────────────────
// {label}.hostels.yourpulse.io serves the client's public listing. Owner-level,
// stored on hms_profiles.subdomain (migration 155).
//
// These go through the service-role client deliberately: a BEFORE UPDATE trigger
// refuses any change to that column when auth.uid() is set, so an owner cannot
// claim a label from their own browser session. Service-role connections have a
// null auth.uid(), which is the only path the trigger permits.

export async function getClientSubdomain(
  ownerId: string
): Promise<{ subdomain?: string | null; enabled?: boolean; error?: string }> {
  try {
    await requireSuperAdmin();
    const admin = createAdminClient();

    const { data, error } = await admin
      .from("hms_profiles")
      .select("subdomain, subdomain_enabled")
      .eq("id", ownerId)
      .maybeSingle();
    if (error) throw error;

    return { subdomain: data?.subdomain ?? null, enabled: data?.subdomain_enabled === true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to load subdomain" };
  }
}

/**
 * Grant or revoke the branded-subdomain add-on for a client (migration 167).
 *
 * Governs CLAIMING only. Revoking does NOT release a subdomain already in use —
 * three clients serve live traffic on theirs, and tearing one down must be a
 * deliberate act via setClientSubdomain(null), never a side effect of a flag.
 *
 * Does not touch the mini website. Every client keeps /find/{slug}, their logo
 * and their business name regardless: that is the acquisition hook, and this is
 * the paid upgrade on top of it.
 *
 * Audit-logged like every other Super Admin grant — this changes what a client
 * is entitled to, so it has to be answerable later.
 */
export async function setClientSubdomainEnabled(
  ownerId: string,
  enabled: boolean
): Promise<{ success?: boolean; error?: string }> {
  try {
    const caller = await requireSuperAdmin();
    const admin = createAdminClient();

    const { error } = await admin
      .from("hms_profiles")
      .update({ subdomain_enabled: enabled })
      .eq("id", ownerId);
    if (error) throw error;

    await writeAuditLog({
      actor_id: caller.id,
      actor_email: caller.email ?? "",
      action: "super_admin.set_client_subdomain_enabled",
      entity: "profile",
      entity_id: ownerId,
      meta: { enabled },
    });

    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to update subdomain access" };
  }
}

/** Pass null or "" to remove a client's subdomain. */
export async function setClientSubdomain(
  ownerId: string,
  subdomain: string | null
): Promise<{ error?: string; subdomain?: string | null }> {
  try {
    const caller = await requireSuperAdmin();
    if (!ownerId) throw new Error("Owner is required");

    const value = subdomain ? normalizeSubdomain(subdomain) : null;

    if (value) {
      const reason = subdomainError(value);
      // Revalidated here, not just in the browser — the form's checks are a
      // convenience and a server action is callable without them.
      if (reason) return { error: reason };
    }

    const admin = createAdminClient();

    // Claimed-by-someone-else is the one failure a Super Admin can actually act
    // on, so name the client instead of surfacing a unique-violation code.
    if (value) {
      const { data: clash } = await admin
        .from("hms_profiles")
        .select("id, full_name")
        .eq("subdomain", value)
        .neq("id", ownerId)
        .maybeSingle();
      if (clash) {
        return { error: `Already used by ${clash.full_name ?? "another client"}` };
      }
    }

    const { error } = await admin
      .from("hms_profiles")
      .update({ subdomain: value })
      .eq("id", ownerId);
    if (error) {
      // Loses the race against a concurrent claim, or trips the CHECK if this
      // file and the migration ever drift.
      if (error.code === "23505") return { error: "That subdomain was just taken" };
      if (error.code === "23514") return { error: "Not a valid subdomain" };
      throw error;
    }

    await writeAuditLog({
      actor_id: caller.id,
      actor_email: caller.email ?? "",
      action: value ? "super_admin.set_client_subdomain" : "super_admin.clear_client_subdomain",
      entity: "profile",
      entity_id: ownerId,
      meta: { subdomain: value },
    });

    return { subdomain: value };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to save subdomain" };
  }
}

// ── getGrowthAnalytics ────────────────────────────────────────────────────────
// Sales-enablement view: where the empty beds are, and what referrals have
// actually returned on the branches running them. The two halves are only
// useful together — empty seats are the problem a prospect already has, and the
// referral figures are the evidence that this product fills them.

export async function getGrowthAnalytics(): Promise<{
  branches?: GrowthBranchRow[];
  totals?: GrowthTotals;
  error?: string;
}> {
  try {
    await requireSuperAdmin();
    const admin = createAdminClient();

    const [hostelsRes, roomsRes, tenantsRes, referralsRes, rewardsRes] = await Promise.all([
      admin
        .from("hms_hostels")
        .select("id, owner_id, name, city, referral_enabled, referral_campaign")
        .order("name"),
      admin.from("hms_rooms").select("hostel_id, capacity"),
      // room_id decides whether a bed is taken; is_waiting excludes the queue,
      // who have been promised nothing yet.
      admin
        .from("hms_tenants")
        .select("id, hostel_id, room_id, is_active, is_waiting")
        .eq("is_active", true),
      admin
        .from("hms_referrals")
        .select("hostel_id, status, matched_tenant_id, pulse_commission_amount, pulse_commission_reversed_at"),
      admin.from("hms_referral_rewards").select("hostel_id, status, applied_amount"),
    ]);

    if (hostelsRes.error) throw hostelsRes.error;

    const hostels = hostelsRes.data ?? [];
    const realHostels = hostels.filter((h) => !isTestOwner(h.owner_id));

    const capacityByHostel = new Map<string, number>();
    for (const r of roomsRes.data ?? []) {
      capacityByHostel.set(
        r.hostel_id as string,
        (capacityByHostel.get(r.hostel_id as string) ?? 0) + Number(r.capacity ?? 0)
      );
    }

    // Derived from tenants, never from hms_rooms.occupied.
    //
    // That counter is maintained by application code and has drifted: on
    // production it reads 60 for a branch with 52 tenants actually in rooms,
    // and 49 for one with 50. Publishing "8 empty beds that are not empty" to a
    // sales team is worse than publishing nothing.
    const filledByHostel = new Map<string, number>();
    const unroomedByHostel = new Map<string, number>();
    const waitingByHostel = new Map<string, number>();
    for (const t of tenantsRes.data ?? []) {
      const h = t.hostel_id as string;
      if (t.is_waiting) {
        waitingByHostel.set(h, (waitingByHostel.get(h) ?? 0) + 1);
        continue;
      }
      if (t.room_id) filledByHostel.set(h, (filledByHostel.get(h) ?? 0) + 1);
      else unroomedByHostel.set(h, (unroomedByHostel.get(h) ?? 0) + 1);
    }

    // Every referred tenant, so their payments can be summed in one pass rather
    // than one query per branch.
    const referredTenantIds = (referralsRes.data ?? [])
      .filter((r) => r.status === "joined" && r.matched_tenant_id)
      .map((r) => r.matched_tenant_id as string);

    const revenueByTenant = new Map<string, number>();
    if (referredTenantIds.length > 0) {
      const { data: paidRows } = await admin
        .from("hms_payments")
        .select("tenant_id, amount_paid, security_deposit_charge, is_reservation")
        .in("tenant_id", referredTenantIds);
      for (const p of paidRows ?? []) {
        if (p.is_reservation) continue;
        // A refundable deposit is the tenant's money being held, not revenue.
        const kept = Number(p.amount_paid ?? 0) - Number(p.security_deposit_charge ?? 0);
        if (kept <= 0) continue;
        revenueByTenant.set(
          p.tenant_id as string,
          (revenueByTenant.get(p.tenant_id as string) ?? 0) + kept
        );
      }
    }

    const refByHostel = new Map<
      string,
      { submitted: number; joined: number; revenue: number; commission: number }
    >();
    for (const r of referralsRes.data ?? []) {
      const h = r.hostel_id as string;
      const acc = refByHostel.get(h) ?? { submitted: 0, joined: 0, revenue: 0, commission: 0 };
      acc.submitted += 1;
      if (r.status === "joined") {
        acc.joined += 1;
        if (r.matched_tenant_id) acc.revenue += revenueByTenant.get(r.matched_tenant_id) ?? 0;
      }
      // A reversed fee was charged and unwound; counting it would overstate what
      // the platform actually earned.
      if (!r.pulse_commission_reversed_at) {
        acc.commission += Number(r.pulse_commission_amount ?? 0);
      }
      refByHostel.set(h, acc);
    }

    const discountByHostel = new Map<string, number>();
    for (const w of rewardsRes.data ?? []) {
      if (w.status !== "applied") continue;
      discountByHostel.set(
        w.hostel_id as string,
        (discountByHostel.get(w.hostel_id as string) ?? 0) + Number(w.applied_amount ?? 0)
      );
    }

    const branches: GrowthBranchRow[] = realHostels.map((h) => {
      const capacity = capacityByHostel.get(h.id) ?? 0;
      const filled = filledByHostel.get(h.id) ?? 0;
      const ref = refByHostel.get(h.id);
      return {
        hostelId: h.id,
        name: h.name,
        city: h.city ?? null,
        capacity,
        filled,
        // Clamped: a branch can legitimately hold more tenants than beds while
        // rooms are still being entered, and a negative "empty seats" is not a
        // number anybody can act on.
        emptySeats: Math.max(0, capacity - filled),
        occupancyPercent: capacity > 0 ? Math.round((filled / capacity) * 100) : 0,
        unroomedTenants: unroomedByHostel.get(h.id) ?? 0,
        waitingTenants: waitingByHostel.get(h.id) ?? 0,
        referralEnabled: h.referral_enabled === true,
        campaign: (h.referral_campaign as string) ?? "off",
        referralsSubmitted: ref?.submitted ?? 0,
        referralsJoined: ref?.joined ?? 0,
        referralRevenue: ref?.revenue ?? 0,
        referralDiscounts: discountByHostel.get(h.id) ?? 0,
        pulseCommission: ref?.commission ?? 0,
      };
    });

    const sum = (pick: (b: GrowthBranchRow) => number) => branches.reduce((s, b) => s + pick(b), 0);
    const totalCapacity = sum((b) => b.capacity);
    const totalFilled = sum((b) => b.filled);

    return {
      branches,
      totals: {
        branches: branches.length,
        capacity: totalCapacity,
        filled: totalFilled,
        emptySeats: sum((b) => b.emptySeats),
        occupancyPercent: totalCapacity > 0 ? Math.round((totalFilled / totalCapacity) * 100) : 0,
        referralsJoined: sum((b) => b.referralsJoined),
        referralRevenue: sum((b) => b.referralRevenue),
        referralDiscounts: sum((b) => b.referralDiscounts),
        pulseCommission: sum((b) => b.pulseCommission),
        branchesRunningReferrals: branches.filter((b) => b.referralEnabled).length,
      },
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to load analytics" };
  }
}
