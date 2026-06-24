"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { writeAuditLog } from "@/lib/audit";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("hms_profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();
  if (!profile?.is_admin) throw new Error("Forbidden: admin access required");
  return user;
}

export interface HostelWithOwner {
  id: string;
  owner_id: string;
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  total_capacity: number;
  created_at: string;
  updated_at: string;
  owner_name: string | null;
  owner_email: string;
}

export async function listAllHostels(): Promise<{ hostels?: HostelWithOwner[]; error?: string }> {
  try {
    await requireAdmin();
    const admin = createAdminClient();

    const [hostelsRes, profilesRes, authRes] = await Promise.all([
      admin.from("hms_hostels").select("*").order("created_at", { ascending: false }),
      admin.from("hms_profiles").select("id, full_name"),
      admin.auth.admin.listUsers({ perPage: 1000 }),
    ]);

    if (hostelsRes.error) throw hostelsRes.error;

    const profileMap = new Map((profilesRes.data ?? []).map((p) => [p.id, p]));
    const authMap = new Map((authRes.data?.users ?? []).map((u) => [u.id, u]));

    const hostels: HostelWithOwner[] = (hostelsRes.data ?? []).map((h) => ({
      ...h,
      owner_name: profileMap.get(h.owner_id)?.full_name ?? null,
      owner_email: authMap.get(h.owner_id)?.email ?? "",
    }));

    return { hostels };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to list hostels" };
  }
}

export async function createHostel(data: {
  owner_id: string;
  name: string;
  address?: string;
  phone?: string;
  email?: string;
  total_capacity?: number;
}): Promise<{ hostelId?: string; error?: string }> {
  try {
    const caller = await requireAdmin();
    if (!data.owner_id || !data.name) throw new Error("Owner and name are required");

    const admin = createAdminClient();
    const { data: hostel, error } = await admin
      .from("hms_hostels")
      .insert({
        owner_id: data.owner_id,
        name: data.name,
        address: data.address || null,
        phone: data.phone || null,
        email: data.email || null,
        total_capacity: data.total_capacity ?? 0,
        listing_enabled: true,
      })
      .select("id")
      .single();

    if (error) throw error;

    await writeAuditLog({
      actor_id: caller.id, actor_email: caller.email ?? "",
      action: "hostel.create", entity: "hostel", entity_id: hostel.id,
      meta: { name: data.name, owner_id: data.owner_id },
    });

    return { hostelId: hostel.id };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to create hostel" };
  }
}

export async function updateHostel(data: {
  hostelId: string;
  name?: string;
  address?: string;
  phone?: string;
  email?: string;
  total_capacity?: number;
}): Promise<{ error?: string }> {
  try {
    const caller = await requireAdmin();
    const admin = createAdminClient();
    const updates: Record<string, unknown> = {};
    if (data.name !== undefined) updates.name = data.name;
    if (data.address !== undefined) updates.address = data.address || null;
    if (data.phone !== undefined) updates.phone = data.phone || null;
    if (data.email !== undefined) updates.email = data.email || null;
    if (data.total_capacity !== undefined) updates.total_capacity = data.total_capacity;

    const { error } = await admin.from("hms_hostels").update(updates).eq("id", data.hostelId);
    if (error) throw error;

    await writeAuditLog({
      actor_id: caller.id, actor_email: caller.email ?? "",
      action: "hostel.update", entity: "hostel", entity_id: data.hostelId,
      meta: { changes: updates },
    });

    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to update hostel" };
  }
}

export async function deleteHostel(hostelId: string): Promise<{ error?: string }> {
  try {
    const caller = await requireAdmin();
    const admin = createAdminClient();

    const { data: hostel } = await admin
      .from("hms_hostels")
      .select("owner_id, name")
      .eq("id", hostelId)
      .single();
    if (!hostel) throw new Error("Hostel not found");

    const { count } = await admin
      .from("hms_hostels")
      .select("*", { count: "exact", head: true })
      .eq("owner_id", hostel.owner_id);
    if ((count ?? 0) <= 1) throw new Error("Cannot delete the owner's last hostel");

    const { error } = await admin.from("hms_hostels").delete().eq("id", hostelId);
    if (error) throw error;

    await writeAuditLog({
      actor_id: caller.id, actor_email: caller.email ?? "",
      action: "hostel.delete", entity: "hostel", entity_id: hostelId,
      meta: { name: hostel.name, owner_id: hostel.owner_id },
    });

    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to delete hostel" };
  }
}

export async function listOwners(): Promise<{
  owners?: { id: string; name: string; email: string }[];
  error?: string;
}> {
  try {
    await requireAdmin();
    const admin = createAdminClient();

    const [profilesRes, authRes] = await Promise.all([
      admin.from("hms_profiles").select("id, full_name").order("full_name"),
      admin.auth.admin.listUsers({ perPage: 1000 }),
    ]);

    const authMap = new Map((authRes.data?.users ?? []).map((u) => [u.id, u]));
    const owners = (profilesRes.data ?? [])
      .map((p) => ({
        id: p.id,
        name: p.full_name ?? "",
        email: authMap.get(p.id)?.email ?? "",
      }))
      .filter((o) => o.email);

    return { owners };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to list owners" };
  }
}
