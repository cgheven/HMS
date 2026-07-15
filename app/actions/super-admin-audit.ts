"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { AuditLog, LoginLog } from "@/types";

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

    const enriched: LoginLogWithProfile[] = logs.map((l) => ({
      ...l,
      full_name: (l.user_id && profileMap.get(l.user_id)?.full_name) ?? null,
      role: (l.user_id && profileMap.get(l.user_id)?.role) ?? null,
    }));

    return { logs: enriched };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to fetch login logs" };
  }
}
