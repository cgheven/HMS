"use server";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOwnerOrAbove } from "@/lib/auth";
import { sendApplicationEmail } from "@/lib/email";
import type { ApplicationStatus, PackageTier } from "@/types";

interface ApplicationInput {
  full_name: string;
  phone: string;
  email?: string;
  cnic?: string;
  package_tier: PackageTier;
  room_preference?: string;
  room_id?: string;
  move_in_date?: string;
  notes?: string;
  cnic_doc_path?: string;
}

export async function submitApplication(hostelId: string, data: ApplicationInput) {
  if (!hostelId) return { success: false, error: "Hostel not found" };
  if (!data.full_name?.trim()) return { success: false, error: "Full name is required" };
  if (!data.phone?.trim()) return { success: false, error: "Phone number is required" };

  // F-005: Phone-based rate limit — max 3 applications per phone in 24 hours.
  // This mirrors the DB-level trigger in migration 024 as an early-exit check
  // so the error message is user-friendly rather than a raw DB exception.
  const admin = createAdminClient();

  // SECURITY: only accept applications for hostels that are publicly listed —
  // this is the sole application entry point now that the room-card popup
  // (which had its own listing_enabled check) has been removed.
  const { data: targetHostel } = await admin
    .from("hms_hostels")
    .select("id")
    .eq("id", hostelId)
    .eq("listing_enabled", true)
    .maybeSingle();
  if (!targetHostel) return { success: false, error: "Hostel not found" };

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: recentCount } = await admin
    .from("hms_tenant_applications")
    .select("id", { count: "exact", head: true })
    .eq("phone", data.phone.trim())
    .gte("applied_at", oneDayAgo);
  if (typeof recentCount === "number" && recentCount >= 3) {
    return { success: false, error: "Too many applications from this number. Please try again tomorrow." };
  }

  // SECURITY: never trust a client-supplied room_id blindly — verify it's a
  // real room belonging to THIS hostel before linking it to the application.
  let verifiedRoomId: string | null = null;
  if (data.room_id) {
    const { data: roomCheck } = await admin
      .from("hms_rooms")
      .select("id")
      .eq("id", data.room_id)
      .eq("hostel_id", hostelId)
      .maybeSingle();
    verifiedRoomId = roomCheck?.id ?? null;
  }

  const { error } = await admin.from("hms_tenant_applications").insert({
    hostel_id: hostelId,
    full_name: data.full_name.trim(),
    phone: data.phone.trim(),
    email: data.email?.trim() || null,
    cnic: data.cnic?.trim() || null,
    package_tier: data.package_tier,
    room_preference: data.room_preference || null,
    room_id: verifiedRoomId,
    move_in_date: data.move_in_date || null,
    notes: data.notes?.trim() || null,
    cnic_doc_path: data.cnic_doc_path || null,
    status: "pending",
  });

  if (error) return { success: false, error: error.message };

  // Fire-and-forget: fetch owner email and send notification; never block the response
  void (async () => {
    try {
      const { data: hostel } = await admin
        .from("hms_hostels")
        .select("name, owner_id")
        .eq("id", hostelId)
        .single();
      if (!hostel) return;
      const { data: { user: owner } } = await admin.auth.admin.getUserById(hostel.owner_id);
      if (!owner?.email) return;
      await sendApplicationEmail({
        ownerEmail: owner.email,
        hostelName: hostel.name,
        applicantName: data.full_name.trim(),
        phone: data.phone.trim(),
        email: data.email?.trim() || null,
        cnic: data.cnic?.trim() || null,
        packageTier: data.package_tier,
        roomPreference: data.room_preference || null,
        moveInDate: data.move_in_date || null,
        notes: data.notes?.trim() || null,
      });
    } catch {
      // Email failure must never surface to the applicant
    }
  })();

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

export async function getApplicationDocUrl(
  path: string
): Promise<{ url?: string; error?: string }> {
  await requireOwnerOrAbove();
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from("application-docs")
    .createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) return { error: error?.message ?? "Could not generate URL." };
  return { url: data.signedUrl };
}

export interface ConvertFormData {
  type: string;
  package_tier: string;
  billing_type: "monthly" | "daily";
  monthly_rent: number;
  daily_rate: number;
  security_deposit: number;
  check_in: string;
  room_id: string | null;
  bed_number: string | null;
  is_waiting: boolean;
  notes: string | null;
  joining_meter_reading?: number | null;
  food_breakfast?: boolean;
  food_lunch?: boolean;
  food_dinner?: boolean;
}

export async function convertToTenant(appId: string, extra: ConvertFormData) {
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

  const { error: tenantError } = await admin.from("hms_tenants").insert({
    hostel_id: app.hostel_id,
    full_name: app.full_name,
    phone: app.phone,
    email: app.email,
    cnic: app.cnic,
    type: extra.type,
    package_tier: extra.package_tier,
    check_in: extra.check_in,
    billing_type: extra.billing_type,
    monthly_rent: extra.billing_type === "monthly" ? extra.monthly_rent : 0,
    daily_rate: extra.billing_type === "daily" ? extra.daily_rate : 0,
    security_deposit: extra.security_deposit,
    room_id: extra.is_waiting ? null : (extra.room_id || null),
    bed_number: extra.bed_number || null,
    is_active: !extra.is_waiting,
    is_waiting: extra.is_waiting,
    notes: extra.notes || null,
    joining_meter_reading: extra.joining_meter_reading ?? null,
    food_breakfast: extra.food_breakfast ?? app.food_breakfast ?? false,
    food_lunch: extra.food_lunch ?? app.food_lunch ?? false,
    food_dinner: extra.food_dinner ?? app.food_dinner ?? false,
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
