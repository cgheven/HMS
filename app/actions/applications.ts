"use server";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValidCnic, normalizeCnic } from "@/lib/cnic";
import { requireOwnerOrPartnerTier } from "@/lib/auth";
import { getManagerContext } from "@/lib/manager-auth";
import { getAuthContext } from "@/lib/data";
import { sendApplicationEmail } from "@/lib/email";
import { sendTenantWelcomeMessageAction } from "@/lib/whatsapp-welcome-action";
import { checkTenantRedflagAction } from "@/app/actions/redflag";
import type { RedflagMatch } from "@/types";
import type { ApplicationStatus, PackageTier, Profile } from "@/types";

/**
 * Who is acting on an application. Managers reach this module through the
 * reused owner Tenants page; they hold no hms_owner_hostels row and
 * getAuthContext() gives them no hostelId, so they need their own branch.
 * Gated on add_members because approving an application IS adding a tenant,
 * and always scoped to the manager's own server-resolved active branch.
 * Every non-manager falls through to the untouched owner/partner path.
 */
type ApplicationActor =
  | { kind: "manager"; hostelId: string; profileId: string | null }
  | { kind: "profile"; profile: Profile };

async function resolveApplicationActor(
  minTier: "read_only" | "standard"
): Promise<ApplicationActor> {
  const mgr = await getManagerContext();
  if (mgr) {
    if (!mgr.permissions.has("add_members")) throw new Error("Access denied");
    if (!mgr.activeHostel) throw new Error("Unauthorized: no active hostel");
    return {
      kind: "manager",
      hostelId: mgr.activeHostel.id,
      // hms_tenant_applications.reviewed_by FKs hms_profiles(id); a manager's
      // profile id is their auth user id.
      profileId: mgr.manager.supabase_user_id,
    };
  }
  return { kind: "profile", profile: await requireOwnerOrPartnerTier(minTier) };
}

async function actorHasAccess(actor: ApplicationActor, hostelId: string): Promise<boolean> {
  if (actor.kind === "manager") return actor.hostelId === hostelId;
  return hasHostelAccess(actor.profile, hostelId);
}

function actorId(actor: ApplicationActor): string | null {
  return actor.kind === "manager" ? actor.profileId : actor.profile.id;
}

/**
 * Partners never appear in hms_owner_hostels — their branch access lives in
 * hms_partnerships, which getAuthContext() already resolves into ctx.hostelId.
 */
async function hasHostelAccess(profile: Profile, hostelId: string): Promise<boolean> {
  if (profile.role === "super_admin") return true;
  if (profile.role === "partner") {
    const ctx = await getAuthContext();
    return ctx?.hostelId === hostelId;
  }
  const admin = createAdminClient();
  const { data: hostel } = await admin
    .from("hms_hostels")
    .select("owner_id")
    .eq("id", hostelId)
    .single();
  if (hostel?.owner_id === profile.id) return true;
  const { data: junction } = await admin
    .from("hms_owner_hostels")
    .select("hostel_id")
    .eq("hostel_id", hostelId)
    .eq("owner_id", profile.id)
    .maybeSingle();
  return !!junction;
}

interface ApplicationInput {
  full_name: string;
  phone: string;
  email?: string;
  cnic?: string;
  type?: string;
  package_tier: PackageTier;
  room_preference?: string;
  room_id?: string;
  move_in_date?: string;
  emergency_contact?: string;
  emergency_phone?: string;
  emergency_relationship?: string;
  permanent_address?: string;
  notes?: string;
  cnic_doc_path?: string;
  institute_name?: string;
  student_category?: string;
  student_specialization?: string;
  organization?: string;
  organization_type?: string;
  department?: string;
}

export async function submitApplication(hostelId: string, data: ApplicationInput) {
  if (!hostelId) return { success: false, error: "Hostel not found" };
  if (!data.full_name?.trim()) return { success: false, error: "Full name is required" };
  if (!data.phone?.trim()) return { success: false, error: "Phone number is required" };
  // The public form is unauthenticated and directly callable, so the format is
  // enforced here too — not just in the browser. Digits-only input is accepted
  // and normalised rather than rejected, matching what the field does on screen.
  if (data.cnic?.trim() && !isValidCnic(normalizeCnic(data.cnic))) {
    return { success: false, error: "Enter a valid 13-digit CNIC, e.g. 42101-1234567-1" };
  }

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
    cnic: normalizeCnic(data.cnic),
    type: data.type || "general",
    package_tier: data.package_tier,
    room_preference: data.room_preference || null,
    room_id: verifiedRoomId,
    move_in_date: data.move_in_date || null,
    emergency_contact: data.emergency_contact?.trim() || null,
    emergency_phone: data.emergency_phone?.trim() || null,
    emergency_relationship: data.emergency_relationship?.trim() || null,
    permanent_address: data.permanent_address?.trim() || null,
    notes: data.notes?.trim() || null,
    cnic_doc_path: data.cnic_doc_path || null,
    institute_name: data.institute_name?.trim() || null,
    student_category: data.student_category || null,
    student_specialization: data.student_specialization?.trim() || null,
    organization: data.organization?.trim() || null,
    organization_type: data.organization_type || null,
    department: data.department?.trim() || null,
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
  const actor = await resolveApplicationActor("read_only");

  const admin = createAdminClient();
  const { data: hostel } = await admin
    .from("hms_hostels")
    .select("id")
    .eq("id", hostelId)
    .single();

  if (!hostel) notFound();

  if (!(await actorHasAccess(actor, hostelId))) {
    return { applications: [], error: "Unauthorized" };
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
  const actor = await resolveApplicationActor("standard");
  const admin = createAdminClient();

  const { data: app } = await admin
    .from("hms_tenant_applications")
    .select("hostel_id")
    .eq("id", appId)
    .single();

  if (!app) return { success: false, error: "Application not found" };

  if (!(await actorHasAccess(actor, app.hostel_id))) {
    return { success: false, error: "Unauthorized" };
  }

  const { error } = await admin
    .from("hms_tenant_applications")
    .update({
      status,
      reviewed_at: new Date().toISOString(),
      reviewed_by: actorId(actor),
    })
    .eq("id", appId);

  if (error) return { success: false, error: error.message };
  return { success: true };
}

export interface ConvertFormData {
  type: string;
  package_tier: string;
  billing_type: "monthly" | "daily";
  monthly_rent: number;
  daily_rate: number;
  security_deposit: number;
  registration_fee?: number;
  vehicle_type?: string | null;
  vehicle_number?: string | null;
  vehicle_model?: string | null;
  check_in: string;
  room_id: string | null;
  bed_number: string | null;
  is_waiting: boolean;
  notes: string | null;
  joining_meter_reading?: number | null;
  food_breakfast?: boolean;
  food_lunch?: boolean;
  food_dinner?: boolean;
  emergency_contact?: string | null;
  emergency_phone?: string | null;
  emergency_relationship?: string | null;
  permanent_address?: string | null;
  institute_name?: string | null;
  student_category?: string | null;
  student_specialization?: string | null;
  organization?: string | null;
  organization_type?: string | null;
  department?: string | null;
}

export interface ConvertToTenantResult {
  success: boolean;
  error?: string;
  /**
   * Unresolved RedFlag reports matching the applicant. Advisory: the approval
   * was paused, not refused — re-calling with `{ ignoreRedflag: true }`
   * completes it unchanged.
   */
  redflagWarning?: RedflagMatch[];
  /**
   * True when the registry could not answer — over budget, unreachable, or the
   * session expired mid-approval. Set on a SUCCESSFUL approval, because the
   * approval is never blocked by a RedFlag outage; it exists so the approver is
   * told "nobody looked" instead of being shown the same silence as a clean
   * applicant.
   */
  redflagUnavailable?: boolean;
}

export async function convertToTenant(
  appId: string,
  extra: ConvertFormData,
  opts?: { ignoreRedflag?: boolean }
): Promise<ConvertToTenantResult> {
  const actor = await resolveApplicationActor("standard");
  const admin = createAdminClient();

  // Fetch application
  const { data: app } = await admin
    .from("hms_tenant_applications")
    .select("*")
    .eq("id", appId)
    .single();

  if (!app) return { success: false, error: "Application not found" };

  if (!(await actorHasAccess(actor, app.hostel_id))) {
    return { success: false, error: "Unauthorized" };
  }

  // Advisory RedFlag check against the applicant's own submitted CNIC/phone —
  // the approver cannot edit either, so it has to happen here. Any failure of
  // the registry is swallowed and the approval proceeds: a RedFlag outage must
  // never stop an application being approved.
  // Tracked so a registry that could not answer is reported as exactly that.
  // "No reports" and "nobody looked" are the same empty list and opposite
  // meanings, and showing the second as the first tells the approver a flagged
  // applicant is clean.
  let redflagUnavailable = false;
  if (!opts?.ignoreRedflag && (app.cnic || app.phone)) {
    try {
      const check = await checkTenantRedflagAction({
        cnic: app.cnic || undefined,
        phone: app.phone || undefined,
      });
      if (check.degraded || check.error) redflagUnavailable = true;
      const live = check.error ? [] : (check.matches ?? []).filter((m) => m.status === "reported");
      if (live.length > 0) return { success: false, redflagWarning: live };
    } catch {
      // The approval still proceeds — see above — but the approver is told.
      redflagUnavailable = true;
    }
  }

  const { data: newTenant, error: tenantError } = await admin.from("hms_tenants").insert({
    hostel_id: app.hostel_id,
    full_name: app.full_name,
    phone: app.phone,
    email: app.email,
    // Normalised on the way through: 38 legacy applications hold digits-only
    // CNICs, and approving one must not carry that malformed value onto the tenant.
    cnic: normalizeCnic(app.cnic),
    type: extra.type,
    package_tier: extra.package_tier,
    check_in: extra.check_in,
    billing_type: extra.billing_type,
    monthly_rent: extra.billing_type === "monthly" ? extra.monthly_rent : 0,
    daily_rate: extra.billing_type === "daily" ? extra.daily_rate : 0,
    security_deposit: extra.security_deposit,
    registration_fee: extra.registration_fee ?? 0,
    vehicle_type: extra.vehicle_type?.trim() || null,
    vehicle_number: extra.vehicle_number?.trim() || null,
    vehicle_model: extra.vehicle_model?.trim() || null,
    room_id: extra.is_waiting ? null : (extra.room_id || null),
    bed_number: extra.bed_number || null,
    is_active: !extra.is_waiting,
    is_waiting: extra.is_waiting,
    notes: extra.notes || null,
    joining_meter_reading: extra.joining_meter_reading ?? null,
    food_breakfast: extra.food_breakfast ?? app.food_breakfast ?? false,
    food_lunch: extra.food_lunch ?? app.food_lunch ?? false,
    food_dinner: extra.food_dinner ?? app.food_dinner ?? false,
    emergency_contact: extra.emergency_contact ?? app.emergency_contact ?? null,
    emergency_phone: extra.emergency_phone ?? app.emergency_phone ?? null,
    emergency_relationship: extra.emergency_relationship ?? app.emergency_relationship ?? null,
    // Carried over from the application so an approved applicant keeps the
    // address they submitted, unless the approver edited it in the dialog.
    permanent_address: extra.permanent_address ?? app.permanent_address ?? null,
    institute_name: extra.institute_name ?? app.institute_name ?? null,
    student_category: extra.student_category ?? app.student_category ?? null,
    student_specialization: extra.student_specialization ?? app.student_specialization ?? null,
    organization: extra.organization ?? app.organization ?? null,
    organization_type: extra.organization_type ?? app.organization_type ?? null,
    department: extra.department ?? app.department ?? null,
  }).select("id").single();

  if (tenantError) return { success: false, error: tenantError.message };

  // Fire-and-forget welcome WhatsApp — never awaited, never blocks approval.
  if (newTenant?.id && !extra.is_waiting) {
    void sendTenantWelcomeMessageAction(newTenant.id);
  }

  // Occupancy must move with the tenant insert on the server: partners cannot
  // write hms_rooms from the browser (RLS), and a blocked update there affects
  // 0 rows silently, leaving the room advertising a bed that is already taken.
  const assignedRoomId = extra.is_waiting ? null : extra.room_id;
  if (assignedRoomId) {
    const { data: room } = await admin
      .from("hms_rooms")
      .select("capacity, occupied")
      .eq("id", assignedRoomId)
      .eq("hostel_id", app.hostel_id)
      .maybeSingle();
    if (room) {
      const newOcc = room.occupied + 1;
      await admin
        .from("hms_rooms")
        .update({ occupied: newOcc, status: newOcc >= room.capacity ? "occupied" : "available" })
        .eq("id", assignedRoomId);
    }
  }

  // Log deposit collection to the Member Ledger — best-effort, never blocks approval.
  if (newTenant?.id && extra.security_deposit > 0) {
    await admin.from("hms_tenant_events").insert({
      hostel_id: app.hostel_id,
      tenant_id: newTenant.id,
      event_type: "deposit_collected",
      amount: extra.security_deposit,
    });
  }

  // Mark application as approved
  await admin
    .from("hms_tenant_applications")
    .update({
      status: "approved",
      reviewed_at: new Date().toISOString(),
      reviewed_by: actorId(actor),
    })
    .eq("id", appId);

  return { success: true, redflagUnavailable };
}
