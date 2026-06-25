"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { writeAuditLog } from "@/lib/audit";
import type { AdminUser } from "@/types";

// ── Guard ────────────────────────────────────────────────────────────────────

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  // Use service role to bypass the recursive RLS policy on hms_profiles
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("hms_profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();

  if (!profile?.is_admin) throw new Error("Forbidden: admin access required");
  return user;
}

// ── List Users ────────────────────────────────────────────────────────────────

export async function listAdminUsers(): Promise<{ users?: AdminUser[]; error?: string }> {
  try {
    await requireAdmin();
    const admin = createAdminClient();

    const [authRes, profilesRes] = await Promise.all([
      admin.auth.admin.listUsers({ perPage: 1000 }),
      admin.from("hms_profiles").select("id, full_name, is_admin, created_at"),
    ]);

    if (authRes.error) throw authRes.error;

    const hostelsRes = await admin
      .from("hms_hostels")
      .select("owner_id, id, name, total_capacity");

    const profileMap = new Map(
      (profilesRes.data ?? []).map((p) => [p.id, p])
    );

    const hostelsByOwner = new Map<string, { id: string; name: string; total_capacity: number }[]>();
    for (const h of (hostelsRes.data ?? [])) {
      if (!hostelsByOwner.has(h.owner_id)) hostelsByOwner.set(h.owner_id, []);
      hostelsByOwner.get(h.owner_id)!.push({ id: h.id, name: h.name, total_capacity: h.total_capacity });
    }

    const users: AdminUser[] = authRes.data.users.map((u) => {
      const profile = profileMap.get(u.id);
      return {
        id: u.id,
        email: u.email ?? "",
        full_name: profile?.full_name ?? null,
        is_admin: profile?.is_admin ?? false,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at ?? null,
        hostels: hostelsByOwner.get(u.id) ?? [],
      };
    });

    return { users };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to list users" };
  }
}

// ── Create User (with password) ───────────────────────────────────────────────

export async function createUserWithPassword(data: {
  email: string;
  password: string;
  full_name: string;
}): Promise<{ userId?: string; error?: string }> {
  try {
    const caller = await requireAdmin();

    if (!data.email || !data.password || data.password.length < 8) {
      throw new Error("Email and password (min 8 chars) are required");
    }

    const admin = createAdminClient();
    const { data: created, error } = await admin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.full_name },
    });

    if (error) throw error;

    // Upsert profile — auth trigger may not fire for admin-created users
    await admin.from("hms_profiles").upsert(
      { id: created.user.id, full_name: data.full_name || null },
      { onConflict: "id", ignoreDuplicates: true }
    );

    await writeAuditLog({
      actor_id: caller.id, actor_email: caller.email ?? "",
      action: "user.create", entity: "user", entity_id: created.user.id,
      meta: { email: data.email, full_name: data.full_name },
    });

    return { userId: created.user.id };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to create user" };
  }
}

// ── Invite User (magic link via email) ───────────────────────────────────────

export async function inviteUser(data: {
  email: string;
  full_name: string;
}): Promise<{ error?: string }> {
  try {
    const caller = await requireAdmin();

    if (!data.email) throw new Error("Email is required");

    const admin = createAdminClient();
    const { data: invited, error } = await admin.auth.admin.inviteUserByEmail(data.email, {
      data: { full_name: data.full_name },
    });

    if (error) throw error;

    // Upsert profile so the user appears in the admin panel immediately
    if (invited.user) {
      await admin.from("hms_profiles").upsert(
        { id: invited.user.id, full_name: data.full_name || null },
        { onConflict: "id", ignoreDuplicates: true }
      );
    }

    await writeAuditLog({
      actor_id: caller.id, actor_email: caller.email ?? "",
      action: "user.invite", entity: "user", entity_id: invited.user?.id,
      meta: { email: data.email, full_name: data.full_name },
    });

    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to send invite" };
  }
}

// ── Update User ───────────────────────────────────────────────────────────────

export async function updateAdminUser(data: {
  userId: string;
  full_name?: string;
  email?: string;
  password?: string;
  is_admin?: boolean;
}): Promise<{ error?: string }> {
  try {
    const caller = await requireAdmin();

    if (!data.userId) throw new Error("userId is required");
    if (data.password && data.password.length < 8) {
      throw new Error("Password must be at least 8 characters");
    }

    const admin = createAdminClient();

    // Update auth user (email / password)
    const authUpdates: { email?: string; password?: string } = {};
    if (data.email) authUpdates.email = data.email;
    if (data.password) authUpdates.password = data.password;

    if (Object.keys(authUpdates).length > 0) {
      const { error } = await admin.auth.admin.updateUserById(data.userId, authUpdates);
      if (error) throw error;
    }

    // Update profile (full_name, is_admin)
    const profileUpdates: { full_name?: string; is_admin?: boolean } = {};
    if (data.full_name !== undefined) profileUpdates.full_name = data.full_name;
    // Prevent revoking own admin
    if (data.is_admin !== undefined && data.userId !== caller.id) {
      profileUpdates.is_admin = data.is_admin;
    }

    if (Object.keys(profileUpdates).length > 0) {
      const { error } = await admin
        .from("hms_profiles")
        .update(profileUpdates)
        .eq("id", data.userId);
      if (error) throw error;
    }

    const changes: Record<string, unknown> = {};
    if (data.email) changes.email = data.email;
    if (data.full_name !== undefined) changes.full_name = data.full_name;
    if (data.is_admin !== undefined) changes.is_admin = data.is_admin;
    if (data.password) changes.password = "***";
    await writeAuditLog({
      actor_id: caller.id, actor_email: caller.email ?? "",
      action: "user.update", entity: "user", entity_id: data.userId,
      meta: { changes },
    });

    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to update user" };
  }
}

// ── Delete User ───────────────────────────────────────────────────────────────

export async function deleteAdminUser(userId: string): Promise<{ error?: string }> {
  try {
    const caller = await requireAdmin();

    if (caller.id === userId) throw new Error("Cannot delete your own account");

    const admin = createAdminClient();
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) throw error;

    await writeAuditLog({
      actor_id: caller.id, actor_email: caller.email ?? "",
      action: "user.delete", entity: "user", entity_id: userId,
    });

    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to delete user" };
  }
}

// ── Reset Password ────────────────────────────────────────────────────────────

export async function resetUserPassword(data: {
  userId: string;
  newPassword: string;
}): Promise<{ error?: string }> {
  try {
    const caller = await requireAdmin();

    if (data.newPassword.length < 8) throw new Error("Password must be at least 8 characters");

    const admin = createAdminClient();

    // SECURITY: block reset of super_admin accounts
    const { data: targetProfile } = await admin
      .from("hms_profiles")
      .select("role")
      .eq("id", data.userId)
      .single();
    if (targetProfile?.role === "super_admin") {
      throw new Error("Cannot reset super_admin password");
    }

    const { error } = await admin.auth.admin.updateUserById(data.userId, {
      password: data.newPassword,
    });
    if (error) throw error;

    await writeAuditLog({
      actor_id: caller.id,
      actor_email: caller.email ?? "",
      action: "admin.reset_user_password",
      entity: "user",
      entity_id: data.userId,
      meta: {},
    });

    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to reset password" };
  }
}
