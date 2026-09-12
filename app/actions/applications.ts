"use server";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValidNationalId, normalizeNationalId, requiresGuestRegistration } from "@/lib/national-id";
import { getCountryConfig, DEFAULT_COUNTRY } from "@/lib/country-config";
import { requireOwnerOrPartnerTier, requireNotFrozenByHostel } from "@/lib/auth";
import { getManagerContext } from "@/lib/manager-auth";
import { getAuthContext } from "@/lib/data";
import { sendApplicationEmail } from "@/lib/email";
import { validateDiscountPercent } from "@/lib/tenant-discount";
import { sendTenantWelcomeMessageAction } from "@/lib/whatsapp-welcome-action";
import { sendAdmissionConfirmationToEmergencyContact } from "@/lib/whatsapp-admission-confirmation";
import { sendWelcomeEmailToTenant } from "@/lib/welcome-email";
import { checkTenantRedflagAction } from "@/app/actions/redflag";
import { normalizeVisitPurpose } from "@/lib/visit-purpose";
import type { RedflagMatch } from "@/types";
import type { ApplicationStatus, PackageTier, Profile } from "@/types";
import { linkReferralForNewTenant } from "@/lib/referral-attribution";
import { ensureAndSendReferralInvite } from "@/lib/whatsapp-referral-invite";

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
  id_type?: string;
  type?: string;
  package_tier: PackageTier;
  room_preference?: string;
  room_id?: string;
  move_in_date?: string;
  emergency_contact?: string;
  emergency_phone?: string;
  emergency_relationship?: string;
  permanent_address?: string;
  permanent_province?: string;
  permanent_district?: string;
  father_name?: string;
  purpose_of_visit?: string;
  purpose_of_visit_detail?: string;
  notes?: string;
  cnic_doc_path?: string;
  institute_name?: string;
  student_category?: string;
  student_specialization?: string;
  organization?: string;
  organization_type?: string;
  department?: string;
  // International admission form (non-guest-registration countries).
  date_of_birth?: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  county_state?: string;
  postcode?: string;
  address_country?: string;
}

export async function submitApplication(hostelId: string, data: ApplicationInput) {
  if (!hostelId) return { success: false, error: "Hostel not found" };
  if (!data.full_name?.trim()) return { success: false, error: "Full name is required" };
  if (!data.phone?.trim()) return { success: false, error: "Phone number is required" };

  const admin = createAdminClient();

  // SECURITY: only accept applications for hostels that are publicly listed —
  // this is the sole application entry point now that the room-card popup
  // (which had its own listing_enabled check) has been removed. Resolve the
  // hostel's country up front: it drives which national-ID format is valid.
  const { data: targetHostel } = await admin
    .from("hms_hostels")
    .select("id, country")
    .eq("id", hostelId)
    .eq("listing_enabled", true)
    .maybeSingle();
  if (!targetHostel) return { success: false, error: "Hostel not found" };
  const country = (targetHostel as { country?: string }).country ?? DEFAULT_COUNTRY;

  // Fixed-national-ID countries (PK/CNIC) enforce the format server-side too.
  // International countries capture a free-text document number of a chosen type
  // (passport/licence/…), so there's no fixed format to validate or normalise.
  const idIsFixed = requiresGuestRegistration(country);
  if (idIsFixed && data.cnic?.trim() && !isValidNationalId(country, data.cnic)) {
    const rule = getCountryConfig(country).nationalId;
    return { success: false, error: `Enter a valid ${rule.label}${rule.example ? `, e.g. ${rule.example}` : ""}` };
  }

  // The public form is directly callable, so validate DoB server-side rather than
  // trusting the browser's `max` guard — a garbage/future date would otherwise
  // reach the `date` column and return a raw Postgres error to the client.
  if (data.date_of_birth) {
    const dob = new Date(data.date_of_birth);
    const wellFormed = /^\d{4}-\d{2}-\d{2}$/.test(data.date_of_birth) && !Number.isNaN(dob.getTime());
    const ageYears = wellFormed ? (Date.now() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000) : -1;
    if (!wellFormed || dob.getTime() > Date.now() || ageYears > 120) {
      return { success: false, error: "Please enter a valid date of birth." };
    }
  }

  // F-005: Phone-based rate limit — max 3 applications per phone in 24 hours.
  // Mirrors the DB-level trigger in migration 024 as a friendly early-exit.

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
    // Fixed ID (PK) is normalised to its canonical format; a free-text
    // international document number is stored as typed (trimmed).
    cnic: idIsFixed ? normalizeNationalId(country, data.cnic) : (data.cnic?.trim() || null),
    id_type: !idIsFixed ? (data.id_type || null) : null,
    type: data.type || "general",
    package_tier: data.package_tier,
    room_preference: data.room_preference || null,
    room_id: verifiedRoomId,
    move_in_date: data.move_in_date || null,
    emergency_contact: data.emergency_contact?.trim() || null,
    emergency_phone: data.emergency_phone?.trim() || null,
    emergency_relationship: data.emergency_relationship?.trim() || null,
    permanent_address: data.permanent_address?.trim() || null,
    permanent_province: data.permanent_province?.trim() || null,
    permanent_district: data.permanent_district?.trim() || null,
    father_name: data.father_name?.trim() || null,
    ...normalizeVisitPurpose(data.purpose_of_visit, data.purpose_of_visit_detail),
    notes: data.notes?.trim() || null,
    cnic_doc_path: data.cnic_doc_path || null,
    institute_name: data.institute_name?.trim() || null,
    student_category: data.student_category || null,
    student_specialization: data.student_specialization?.trim() || null,
    organization: data.organization?.trim() || null,
    organization_type: data.organization_type || null,
    department: data.department?.trim() || null,
    // International admission form fields (non-guest-registration countries).
    date_of_birth: data.date_of_birth || null,
    address_line1: data.address_line1?.trim() || null,
    address_line2: data.address_line2?.trim() || null,
    city: data.city?.trim() || null,
    county_state: data.county_state?.trim() || null,
    postcode: data.postcode?.trim() || null,
    address_country: data.address_country?.trim() || null,
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
  await requireNotFrozenByHostel(app.hostel_id);

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
  /** Standing rent concession agreed at admission. Null = none. Monthly only —
   *  a nightly bill carries no rent discount (migration 212). */
  discount_percent?: number | null;
  daily_rate: number;
  security_deposit: number;
  registration_fee?: number;
  /** Null/undefined = inherit the branch rate. 0 = waived for this tenant. */
  ac_maintenance?: number | null;
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
  permanent_province?: string | null;
  permanent_district?: string | null;
  father_name?: string | null;
  purpose_of_visit?: string | null;
  purpose_of_visit_detail?: string | null;
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

  // Bounded here as on every other tenant write path, so a bad value comes back
  // as a sentence rather than a Postgres constraint dump.
  const discountError = validateDiscountPercent(extra.discount_percent ?? null);
  if (discountError) return { error: discountError } as ConvertToTenantResult;

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
  await requireNotFrozenByHostel(app.hostel_id);

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

  // Resolve the hostel's country so the ID is normalised per its own format.
  const { data: appHostel } = await admin
    .from("hms_hostels").select("country").eq("id", app.hostel_id).maybeSingle();
  const appCountry = (appHostel as { country?: string } | null)?.country ?? DEFAULT_COUNTRY;

  const { data: newTenant, error: tenantError } = await admin.from("hms_tenants").insert({
    hostel_id: app.hostel_id,
    full_name: app.full_name,
    phone: app.phone,
    email: app.email,
    // Fixed ID (PK) is normalised to canonical form (38 legacy apps hold
    // digits-only CNICs); an international free-text document number is carried
    // as-is (normalising would strip letters from a passport/licence number).
    cnic: requiresGuestRegistration(appCountry) ? normalizeNationalId(appCountry, app.cnic) : (app.cnic ?? null),
    id_type: app.id_type ?? null,
    type: extra.type,
    package_tier: extra.package_tier,
    check_in: extra.check_in,
    billing_type: extra.billing_type,
    monthly_rent: extra.billing_type === "monthly" ? extra.monthly_rent : 0,
    discount_percent: extra.billing_type === "monthly" ? (extra.discount_percent ?? null) : null,
    daily_rate: extra.billing_type === "daily" ? extra.daily_rate : 0,
    security_deposit: extra.security_deposit,
    registration_fee: extra.registration_fee ?? 0,
    ac_maintenance: extra.ac_maintenance ?? null,
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
    permanent_province: extra.permanent_province ?? app.permanent_province ?? null,
    permanent_district: extra.permanent_district ?? app.permanent_district ?? null,
    father_name: extra.father_name ?? app.father_name ?? null,
    purpose_of_visit: extra.purpose_of_visit ?? app.purpose_of_visit ?? null,
    // Follows purpose_of_visit rather than resolving independently: if the
    // approver changed the purpose to a preset, the applicant's old "other"
    // description must not survive attached to it.
    purpose_of_visit_detail:
      (extra.purpose_of_visit ?? app.purpose_of_visit ?? null) === "other"
        ? extra.purpose_of_visit_detail ?? app.purpose_of_visit_detail ?? null
        : null,
    institute_name: extra.institute_name ?? app.institute_name ?? null,
    student_category: extra.student_category ?? app.student_category ?? null,
    student_specialization: extra.student_specialization ?? app.student_specialization ?? null,
    organization: extra.organization ?? app.organization ?? null,
    organization_type: extra.organization_type ?? app.organization_type ?? null,
    department: extra.department ?? app.department ?? null,
    // International admission fields carried from the application to the tenant.
    date_of_birth: app.date_of_birth ?? null,
    address_line1: app.address_line1 ?? null,
    address_line2: app.address_line2 ?? null,
    city: app.city ?? null,
    county_state: app.county_state ?? null,
    postcode: app.postcode ?? null,
    address_country: app.address_country ?? null,
  }).select("id").single();

  if (tenantError) return { success: false, error: tenantError.message };

  // Fire-and-forget welcome WhatsApp — never awaited, never blocks approval.
  // The emergency contact gets a separate one-time admission confirmation.
  if (newTenant?.id && !extra.is_waiting) {
    void sendTenantWelcomeMessageAction(newTenant.id);
    void sendWelcomeEmailToTenant(newTenant.id);
    void sendAdmissionConfirmationToEmergencyContact(newTenant.id);
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


  // Attribution runs LAST, after every write that makes an admission complete
  // (room occupancy, deposit ledger, application status). try/catch bounds a
  // THROW, not TIME: supabase-js sets no fetch timeout, so a stalled query is an
  // unbounded await the catch never sees — the platform kills the invocation
  // instead. Sitting mid-sequence, that left the tenant row committed with
  // occupancy un-incremented and the application still pending, and the
  // operator's natural retry created a SECOND tenant. Last means a stall can
  // only ever cost the attribution.
  // Skipped for a waiting-list row on purpose, mirroring the welcome message
  // above. A waiting tenant has not moved in, has no bill and no deadline to
  // measure against — attributing here would CONSUME the referral at 'joined'
  // and leave nothing to pay out when they actually activate. Firing on the
  // activation transition is Phase 2 Step 0.
  if (newTenant?.id && !extra.is_waiting) {
    await linkReferralForNewTenant(admin, {
      tenantId: newTenant.id,
      hostelId: app.hostel_id,
      phone: app.phone,
      checkIn: extra.check_in,
    });
      // Their own link, so the owner never hands one out by hand. Fire and
      // forget: a marketing message must not be able to fail an admission, and
      // every gate is re-checked inside the helper at the moment of sending.
    void ensureAndSendReferralInvite(admin, app.hostel_id, newTenant.id);
  }

  return { success: true, redflagUnavailable };
}
