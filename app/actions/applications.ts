"use server";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOwnerOrAbove } from "@/lib/auth";
import type { ApplicationStatus, PackageTier } from "@/types";

interface ApplicationInput {
  full_name: string;
  phone: string;
  email?: string;
  cnic?: string;
  package_tier: PackageTier;
  room_preference?: string;
  move_in_date?: string;
  notes?: string;
}

export async function submitApplication(hostelId: string, data: ApplicationInput) {
  if (!hostelId) return { success: false, error: "Hostel not found" };
  if (!data.full_name?.trim()) return { success: false, error: "Full name is required" };
  if (!data.phone?.trim()) return { success: false, error: "Phone number is required" };

  // F-005: Phone-based rate limit — max 3 applications per phone in 24 hours.
  // This mirrors the DB-level trigger in migration 024 as an early-exit check
  // so the error message is user-friendly rather than a raw DB exception.
  const admin = createAdminClient();
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: recentCount } = await admin
    .from("hms_tenant_applications")
    .select("id", { count: "exact", head: true })
    .eq("phone", data.phone.trim())
    .gte("applied_at", oneDayAgo);
  if (typeof recentCount === "number" && recentCount >= 3) {
    return { success: false, error: "Too many applications from this number. Please try again tomorrow." };
  }

  const { error } = await admin.from("hms_tenant_applications").insert({
    hostel_id: hostelId,
    full_name: data.full_name.trim(),
    phone: data.phone.trim(),
    email: data.email?.trim() || null,
    cnic: data.cnic?.trim() || null,
    package_tier: data.package_tier,
    room_preference: data.room_preference || null,
    move_in_date: data.move_in_date || null,
    notes: data.notes?.trim() || null,
    status: "pending",
  });

  if (error) return { success: false, error: error.message };
  return { success: true };
}

export async function listApplications(hostelId: string) {
  const profile = await requireOwnerOrAbove();

  // Verify ownership
  const admin = createAdminClient();
  const { data: hostel } = await admin
    .from("hms_hostels")
    .select("id, owner_id")
    .eq("id", hostelId)
    .single();

  if (!hostel) notFound();

  // For non-super-admin check ownership
  if (profile.role !== "super_admin") {
    if (hostel.owner_id !== profile.id) {
      // Check junction table
      const { data: junction } = await admin
        .from("hms_owner_hostels")
        .select("hostel_id")
        .eq("hostel_id", hostelId)
        .eq("owner_id", profile.id)
        .maybeSingle();
      if (!junction) return { applications: [], error: "Unauthorized" };
    }
  }

  const { data, error } = await admin
    .from("hms_tenant_applications")
    .select("*")
    .eq("hostel_id", hostelId)
    .order("applied_at", { ascending: false });

  if (error) return { applications: [], error: error.message };
  return { applications: data ?? [], error: null };
}

export async function updateApplicationStatus(
  appId: string,
  status: ApplicationStatus
) {
  const profile = await requireOwnerOrAbove();
  const admin = createAdminClient();

  const { data: app } = await admin
    .from("hms_tenant_applications")
    .select("hostel_id")
    .eq("id", appId)
    .single();

  if (!app) return { success: false, error: "Application not found" };

  // Verify ownership
  if (profile.role !== "super_admin") {
    const { data: hostel } = await admin
      .from("hms_hostels")
      .select("owner_id")
      .eq("id", app.hostel_id)
      .single();

    if (!hostel || hostel.owner_id !== profile.id) {
      const { data: junction } = await admin
        .from("hms_owner_hostels")
        .select("hostel_id")
        .eq("hostel_id", app.hostel_id)
        .eq("owner_id", profile.id)
        .maybeSingle();
      if (!junction) return { success: false, error: "Unauthorized" };
    }
  }

  const { error } = await admin
    .from("hms_tenant_applications")
    .update({
      status,
      reviewed_at: new Date().toISOString(),
      reviewed_by: profile.id,
    })
    .eq("id", appId);

  if (error) return { success: false, error: error.message };
  return { success: true };
}

export async function convertToTenant(appId: string) {
  const profile = await requireOwnerOrAbove();
  const admin = createAdminClient();

  // Fetch application
  const { data: app } = await admin
    .from("hms_tenant_applications")
    .select("*")
    .eq("id", appId)
    .single();

  if (!app) return { success: false, error: "Application not found" };

  // Verify hostel ownership
  if (profile.role !== "super_admin") {
    const { data: hostel } = await admin
      .from("hms_hostels")
      .select("owner_id")
      .eq("id", app.hostel_id)
      .single();

    if (!hostel || hostel.owner_id !== profile.id) {
      const { data: junction } = await admin
        .from("hms_owner_hostels")
        .select("hostel_id")
        .eq("hostel_id", app.hostel_id)
        .eq("owner_id", profile.id)
        .maybeSingle();
      if (!junction) return { success: false, error: "Unauthorized" };
    }
  }

  // Insert into hms_tenants (waiting list — no room assigned yet)
  const today = new Date().toISOString().split("T")[0];
  const { error: tenantError } = await admin.from("hms_tenants").insert({
    hostel_id: app.hostel_id,
    full_name: app.full_name,
    phone: app.phone,
    email: app.email,
    cnic: app.cnic,
    type: app.room_preference ?? "general",
    package_tier: app.package_tier ?? "space_only",
    check_in: app.move_in_date ?? today,
    billing_type: "monthly",
    monthly_rent: 0,
    daily_rate: 0,
    security_deposit: 0,
    is_active: false,
    is_waiting: true,
    notes: app.notes,
  });

  if (tenantError) return { success: false, error: tenantError.message };

  // Mark application as approved
  await admin
    .from("hms_tenant_applications")
    .update({
      status: "approved",
      reviewed_at: new Date().toISOString(),
      reviewed_by: profile.id,
    })
    .eq("id", appId);

  return { success: true };
}
