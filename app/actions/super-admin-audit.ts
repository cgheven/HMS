"use server";
import { getProfile } from "@/lib/auth";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  FEATURE_KEYS, type AuditLog, type LoginLog, type FeatureKey,
  type ClientActivityRow, type ActivityFeedEvent,
} from "@/types";

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

export type LoginLogWithProfile = LoginLog & {
  full_name: string | null;
  role: string | null;
};

// ── Queries ───────────────────────────────────────────────────────────────────

export async function listAuditLogs(): Promise<{ logs?: AuditLog[]; error?: string }> {
  try {
    await requireSuperAdmin();
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("hms_audit_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw error;
    return { logs: (data ?? []) as AuditLog[] };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to fetch audit logs" };
  }
}

export async function listLoginLogs(): Promise<{ logs?: LoginLogWithProfile[]; error?: string }> {
  try {
    await requireSuperAdmin();
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("hms_login_log")
      .select("*")
      .order("logged_in_at", { ascending: false })
      .limit(500);
    if (error) throw error;
    const logs = (data ?? []) as LoginLog[];

    // hms_login_log.user_id references auth.users, not hms_profiles, so there's
    // no FK path PostgREST can embed through — resolve names/roles in one extra query.
    const userIds = Array.from(new Set(logs.map((l) => l.user_id).filter((id): id is string => !!id)));
    const profileMap = new Map<string, { full_name: string | null; role: string | null }>();
    if (userIds.length > 0) {
      const { data: profiles } = await admin
        .from("hms_profiles")
        .select("id, full_name, role")
        .in("id", userIds);
      for (const p of profiles ?? []) {
        profileMap.set(p.id, { full_name: p.full_name, role: p.role });
      }
    }

    const enriched: LoginLogWithProfile[] = logs
      .map((l) => ({
        ...l,
        full_name: (l.user_id && profileMap.get(l.user_id)?.full_name) ?? null,
        role: (l.user_id && profileMap.get(l.user_id)?.role) ?? null,
      }))
      // Internal team, not clients — their own actions already show in Admin Actions.
      .filter((l) => l.role !== "super_admin" && l.role !== "sales_rep");

    return { logs: enriched };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to fetch login logs" };
  }
}

// ── listClientActivity ────────────────────────────────────────────────────────
// No dedicated events/analytics table exists — this is built entirely from the
// created_at timestamps already on each feature's own table, keyed by hostel_id.
// One row per BRANCH (not rolled up to owner) — a client's branches can vary a
// lot in how much they're actually used, and that variance is the whole point.
// Table sizes are small enough (low hundreds of rows) to fetch raw and reduce
// in JS, same approach listAllHostels already uses for tenant counts.

type FeatureTable = { table: string; key: FeatureKey };
const FEATURE_TABLES: FeatureTable[] = [
  { table: "hms_tenants", key: "tenants" },
  { table: "hms_payments", key: "payments" },
  { table: "hms_expenses", key: "expenses" },
  { table: "hms_kitchen_expenses", key: "kitchen" },
  { table: "hms_employees", key: "staff" },
  { table: "hms_complaints", key: "complaints" },
  { table: "hms_room_ac_readings", key: "acBilling" },
  { table: "hms_manager_hostels", key: "team" },
];

function emptyFeatures(): Record<FeatureKey, { count: number; lastUsedAt: string | null }> {
  const out = {} as Record<FeatureKey, { count: number; lastUsedAt: string | null }>;
  for (const key of FEATURE_KEYS) out[key] = { count: 0, lastUsedAt: null };
  return out;
}

export async function listClientActivity(): Promise<{ rows?: ClientActivityRow[]; error?: string }> {
  try {
    await requireSuperAdmin();
    const admin = createAdminClient();

    const [hostelsRes, ownersRes, authRes, loginsRes, ...featureResults] = await Promise.all([
      admin.from("hms_hostels").select("id, name, owner_id"),
      admin.from("hms_profiles").select("id, full_name").eq("role", "owner"),
      admin.auth.admin.listUsers({ perPage: 1000 }),
      admin.from("hms_login_log").select("user_id, logged_in_at"),
      ...FEATURE_TABLES.map(({ table }) => admin.from(table).select("hostel_id, created_at")),
    ]);

    if (hostelsRes.error) throw hostelsRes.error;
    if (ownersRes.error) throw ownersRes.error;

    const authMap = new Map((authRes.data?.users ?? []).map((u) => [u.id, u]));
    const ownerNameMap = new Map((ownersRes.data ?? []).map((o) => [o.id, o.full_name]));

    const lastLoginMap = new Map<string, string>();
    for (const l of loginsRes.data ?? []) {
      if (!l.user_id) continue;
      const prev = lastLoginMap.get(l.user_id);
      if (!prev || l.logged_in_at > prev) lastLoginMap.set(l.user_id, l.logged_in_at);
    }

    const featureByHostel = new Map<string, Record<FeatureKey, { count: number; lastUsedAt: string | null }>>();
    function bump(hostelId: string, key: FeatureKey, createdAt: string) {
      if (!featureByHostel.has(hostelId)) featureByHostel.set(hostelId, emptyFeatures());
      const entry = featureByHostel.get(hostelId)![key];
      entry.count += 1;
      if (!entry.lastUsedAt || createdAt > entry.lastUsedAt) entry.lastUsedAt = createdAt;
    }

    FEATURE_TABLES.forEach(({ key }, i) => {
      const rows = (featureResults[i].data ?? []) as { hostel_id: string; created_at: string }[];
      for (const row of rows) bump(row.hostel_id, key, row.created_at);
    });

    const rows: ClientActivityRow[] = (hostelsRes.data ?? []).map((h) => ({
      hostelId: h.id,
      hostelName: h.name,
      ownerId: h.owner_id,
      ownerName: ownerNameMap.get(h.owner_id) ?? null,
      ownerEmail: authMap.get(h.owner_id)?.email ?? "",
      lastLogin: lastLoginMap.get(h.owner_id) ?? null,
      features: featureByHostel.get(h.id) ?? emptyFeatures(),
    }));

    return { rows };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to fetch client activity" };
  }
}

// ── listActivityFeed ───────────────────────────────────────────────────────────

export async function listActivityFeed(): Promise<{ events?: ActivityFeedEvent[]; error?: string }> {
  try {
    await requireSuperAdmin();
    const admin = createAdminClient();

    const [logsRes, hostelsRes, profilesRes, authRes] = await Promise.all([
      admin.from("hms_activity_log").select("*").order("created_at", { ascending: false }).limit(500),
      admin.from("hms_hostels").select("id, name, owner_id"),
      admin.from("hms_profiles").select("id, full_name"),
      admin.auth.admin.listUsers({ perPage: 1000 }),
    ]);

    if (logsRes.error) throw logsRes.error;

    const hostelMap = new Map((hostelsRes.data ?? []).map((h) => [h.id, h]));
    const nameMap = new Map((profilesRes.data ?? []).map((p) => [p.id, p.full_name]));
    const emailMap = new Map((authRes.data?.users ?? []).map((u) => [u.id, u.email ?? null]));

    const events: ActivityFeedEvent[] = (logsRes.data ?? []).map((log) => {
      const hostel = log.hostel_id ? hostelMap.get(log.hostel_id) : undefined;
      return {
        id: log.id,
        hostelId: log.hostel_id,
        hostelName: hostel?.name ?? null,
        ownerName: hostel ? (nameMap.get(hostel.owner_id) ?? null) : null,
        actorId: log.actor_id,
        actorName: log.actor_id ? (nameMap.get(log.actor_id) ?? null) : null,
        actorEmail: log.actor_id ? (emailMap.get(log.actor_id) ?? null) : null,
        action: log.action,
        entity: log.entity,
        entityId: log.entity_id,
        meta: log.meta,
        createdAt: log.created_at,
      };
    });

    return { events };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to fetch activity feed" };
  }
}
