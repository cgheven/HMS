"use server"

import { randomBytes } from "crypto"
import { revalidatePath } from "next/cache"
import { unstable_rethrow } from "next/navigation"
import { requireOwnerOrAbove } from "@/lib/auth"
import { getAuthContext } from "@/lib/data"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireManagerPermission } from "@/lib/manager-auth"
import { logActivity } from "@/lib/audit"
import { backfillTenantPaymentsAction, logTenantEvent } from "@/app/actions/tenants"
import { sendTenantWelcomeMessageAction } from "@/lib/whatsapp-welcome-action"
import { computeACSegmentBilling, deriveOpeningReading } from "@/lib/ac-billing"
import { calcBaseRentServer, dailySnapshot, computeDepositCharge, computeRegistrationFeeCharge } from "@/lib/payment-calc"
import { calcFoodAddonCharge } from "@/lib/food-addon"
import { performTenantCheckout } from "@/lib/tenant-checkout"
import { pktYearMonth } from "@/lib/pkt-time"
import { isValidCnic, normalizeCnic } from "@/lib/cnic"
import type { PartnerTenantPayload } from "@/app/actions/partner"
import type { Manager, Payment, PackageTier, PaymentStatus, StaffPermission, CheckoutInput, CheckoutSettlement } from "@/types"
import { linkReferralForNewTenant } from "@/lib/referral-attribution"
import { normalizeVisitPurpose } from "@/lib/visit-purpose";

function firstOfNextMonth(forMonth: string): string {
  const [y, m] = forMonth.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

function getPrevMonth(forMonth: string): string {
  const [y, m] = forMonth.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

async function resolveOwnerId(): Promise<string> {
  const ctx = await getAuthContext()
  if (!ctx?.user) throw new Error("Unauthorized")
  return ctx.user.id
}

function buildSyntheticEmail(normalizedPhone: string): string {
  return `${normalizedPhone}@hms-portal.internal`
}

function generateManagerPassword(): string {
  const upper   = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
  const lower   = "abcdefghijklmnopqrstuvwxyz"
  const digits  = "0123456789"
  const special = "@#$!&"
  const all     = upper + lower + digits + special

  // Rejection-sampling avoids modulo bias for any charset length.
  function pick(set: string): string {
    const max = Math.floor(256 / set.length) * set.length
    let byte: number
    do { byte = randomBytes(1)[0] } while (byte >= max)
    return set[byte % set.length]
  }

  const chars = [
    pick(upper),
    pick(lower),
    pick(digits),
    pick(special),
    ...Array.from({ length: 4 }, () => pick(all)),
  ]

  // Fisher-Yates shuffle with rejection-sampled index
  for (let i = chars.length - 1; i > 0; i--) {
    const max = Math.floor(256 / (i + 1)) * (i + 1)
    let byte: number
    do { byte = randomBytes(1)[0] } while (byte >= max)
    const j = byte % (i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }

  return chars.join("")
}

export async function createManager(
  name: string,
  phone: string,
): Promise<{ manager: Manager | null; error: string | null }> {
  await requireOwnerOrAbove()
  const ownerId = await resolveOwnerId()

  const normalizedPhone = phone.replace(/\D/g, "")

  const admin = createAdminClient()
  const { data, error } = await admin
    .from("hms_managers")
    .insert({ owner_id: ownerId, name: name.trim(), phone: normalizedPhone })
    .select("*, permissions:hms_manager_permissions(permission), hostels:hms_manager_hostels(hostel_id, hostel:hms_hostels(id, name))")
    .single()

  if (error) {
    if (error.code === "23505") {
      return { manager: null, error: "A manager with this phone number already exists." }
    }
    return { manager: null, error: error.message }
  }

  revalidatePath("/managers")

  const manager: Manager = {
    ...data,
    permissions: (data.permissions ?? []).map((p: { permission: string }) => p.permission as StaffPermission),
    hostels: (data.hostels ?? []).map((h: { hostel: { id: string; name: string } }) => h.hostel).filter(Boolean),
  }

  await logActivity({
    hostel_id: null,
    actor_id: ownerId,
    action: "manager.invite",
    entity: "manager",
    entity_id: data.id,
    meta: { name: name.trim() },
  })

  return { manager, error: null }
}

export async function updateManagerPermissions(
  managerId: string,
  permissions: StaffPermission[],
): Promise<{ error: string | null }> {
  await requireOwnerOrAbove()
  const ownerId = await resolveOwnerId()

  const admin = createAdminClient()

  const { data: mgr } = await admin
    .from("hms_managers")
    .select("id")
    .eq("id", managerId)
    .eq("owner_id", ownerId)
    .single()

  if (!mgr) return { error: "Manager not found or access denied." }

  const VALID_PERMISSIONS = new Set<StaffPermission>([
    "add_members", "collect_payments", "add_expenses", "add_kitchen_expenses",
    "edit_members", "edit_expenses", "edit_kitchen_expenses", "manage_rooms",
  ])
  for (const p of permissions) {
    if (!VALID_PERMISSIONS.has(p)) return { error: `Invalid permission: ${p}` }
  }

  await admin.from("hms_manager_permissions").delete().eq("manager_id", managerId)

  if (permissions.length > 0) {
    const rows = permissions.map((p) => ({ manager_id: managerId, permission: p }))
    const { error } = await admin.from("hms_manager_permissions").insert(rows)
    if (error) return { error: error.message }
  }

  revalidatePath("/managers")
  return { error: null }
}

export async function updateManagerHostels(
  managerId: string,
  hostelIds: string[],
): Promise<{ error: string | null }> {
  await requireOwnerOrAbove()
  const ownerId = await resolveOwnerId()

  const admin = createAdminClient()

  const { data: mgr } = await admin
    .from("hms_managers")
    .select("id")
    .eq("id", managerId)
    .eq("owner_id", ownerId)
    .single()

  if (!mgr) return { error: "Manager not found or access denied." }

  if (hostelIds.length > 0) {
    const { data: validHostels } = await admin
      .from("hms_hostels")
      .select("id")
      .in("id", hostelIds)
      .eq("owner_id", ownerId)

    if (!validHostels || validHostels.length !== hostelIds.length) {
      return { error: "One or more hostels are invalid or not owned by you." }
    }
  }

  await admin.from("hms_manager_hostels").delete().eq("manager_id", managerId)

  if (hostelIds.length > 0) {
    const rows = hostelIds.map((hid) => ({ manager_id: managerId, hostel_id: hid }))
    const { error } = await admin.from("hms_manager_hostels").insert(rows)
    if (error) return { error: error.message }
  }

  revalidatePath("/managers")
  return { error: null }
}

export async function createManagerLogin(
  managerId: string,
): Promise<{ phone: string; password: string } | { error: string }> {
  await requireOwnerOrAbove()
  const ownerId = await resolveOwnerId()

  const admin = createAdminClient()

  const { data: mgr } = await admin
    .from("hms_managers")
    .select("id, phone, has_login, supabase_user_id")
    .eq("id", managerId)
    .eq("owner_id", ownerId)
    .single()

  if (!mgr) return { error: "Manager not found or access denied." }

  // EC-04 / EC-12: Allow re-generation only if supabase_user_id is null
  if (mgr.has_login && mgr.supabase_user_id) {
    return { error: "This manager already has a login. Use Reset Password instead." }
  }

  const password = generateManagerPassword()
  const email = buildSyntheticEmail(mgr.phone)

  const { data: authData, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { role: "manager", manager_id: managerId },
  })

  if (createError || !authData?.user) {
    return { error: createError?.message ?? "Failed to create auth user." }
  }

  const { error: updateError } = await admin
    .from("hms_managers")
    .update({ supabase_user_id: authData.user.id, has_login: true })
    .eq("id", managerId)

  if (updateError) {
    await admin.auth.admin.deleteUser(authData.user.id)
    return { error: updateError.message }
  }

  revalidatePath("/managers")
  return { phone: mgr.phone, password }
}

export async function resetManagerPassword(
  managerId: string,
): Promise<{ password: string } | { error: string }> {
  await requireOwnerOrAbove()
  const ownerId = await resolveOwnerId()

  const admin = createAdminClient()

  const { data: mgr } = await admin
    .from("hms_managers")
    .select("id, supabase_user_id")
    .eq("id", managerId)
    .eq("owner_id", ownerId)
    .single()

  if (!mgr) return { error: "Manager not found or access denied." }
  if (!mgr.supabase_user_id) return { error: "This manager does not have an active login." }

  const password = generateManagerPassword()

  const { error } = await admin.auth.admin.updateUserById(mgr.supabase_user_id, { password })

  if (error) return { error: error.message }

  // Changing the password invalidates all existing refresh tokens via GoTrue.
  // Active access tokens (≤1hr TTL) continue until natural expiry — acceptable for this use case.
  revalidatePath("/managers")
  return { password }
}

export async function deleteManager(
  managerId: string,
): Promise<{ error: string | null }> {
  await requireOwnerOrAbove()
  const ownerId = await resolveOwnerId()

  const admin = createAdminClient()

  const { data: mgr } = await admin
    .from("hms_managers")
    .select("id, supabase_user_id")
    .eq("id", managerId)
    .eq("owner_id", ownerId)
    .single()

  if (!mgr) return { error: "Manager not found or access denied." }

  // Delete DB row first (cascade removes permissions + hostel assignments).
  // Only then delete the auth user — if DB delete fails, the auth user is preserved
  // and the data stays consistent.
  const { error: dbError } = await admin
    .from("hms_managers")
    .delete()
    .eq("id", managerId)

  if (dbError) return { error: dbError.message }

  if (mgr.supabase_user_id) {
    const { error: authError } = await admin.auth.admin.deleteUser(mgr.supabase_user_id)
    if (authError) {
      // GoTrue deletion failed. The hms_managers row is already gone so portal access is
      // blocked, but the auth user's hms_profiles row (role='manager') would survive.
      // Delete it directly so requireOwnerOrAbove() can never pass for this user again.
      await admin.from("hms_profiles").delete().eq("id", mgr.supabase_user_id)
    }
  }

  revalidatePath("/managers")
  return { error: null }
}

export async function applyRoomACUnitsAsManager(
  roomId: string,
  forMonth: string,
  meterReading: number,
  openingReading?: number,
): Promise<{ error: string | null; eligibleCount?: number; perTenantUnits?: number; perTenantCharge?: number; derivedUnits?: number; prevMonthReading?: number; currentReading?: number }> {
  try {
    const ctx = await requireManagerPermission("collect_payments")
    const hostelId = ctx.activeHostel.id
    const admin = createAdminClient()

    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(forMonth)) return { error: "Invalid month." }

    const reading = Math.round(Number(meterReading))
    if (!Number.isFinite(reading) || reading < 0 || reading > 999_999) {
      return { error: "Meter reading must be between 0 and 999,999." }
    }
    if (openingReading !== undefined) {
      const or = Math.round(Number(openingReading))
      if (!Number.isFinite(or) || or < 0 || or > 999_999) return { error: "Opening reading must be between 0 and 999,999." }
    }

    const currentMonth = forMonth
    const prevMonthStr = getPrevMonth(forMonth)

    // Verify room, get config, fetch previous month reading, active tenants, join readings, and checkout readings in parallel
    const [{ data: room }, { data: config }, { data: prevRecord }, { data: allTenants, error: allTenantsErr }, { data: joinReadingsRaw }, { data: checkoutReadingsRaw }] = await Promise.all([
      admin.from("hms_rooms").select("id, has_ac").eq("id", roomId).eq("hostel_id", hostelId).single(),
      admin.from("hms_package_configs").select("ac_per_unit_rate, food_monthly_rate, food_breakfast_rate, food_lunch_rate, food_dinner_rate, food_all_meals_rate, ac_maintenance_rate").eq("hostel_id", hostelId).maybeSingle(),
      admin.from("hms_room_ac_readings").select("meter_reading").eq("room_id", roomId).eq("hostel_id", hostelId).eq("for_month", prevMonthStr).maybeSingle(),
      // Scoped to tenants who had moved in by the month being billed — see
      // applyRoomACUnitsAction for why a back-dated apply otherwise charges
      // later arrivals for a month they were not there.
      admin
        .from("hms_tenants")
        .select("id, check_in, package_tier, monthly_rent, daily_rate, billing_type, check_out, security_deposit, deposit_collected_amount, registration_fee, food_breakfast, food_lunch, food_dinner, joining_meter_reading")
        .eq("hostel_id", hostelId)
        .eq("room_id", roomId)
        .eq("is_active", true)
        .lt("check_in", firstOfNextMonth(currentMonth)),
      admin
        .from("hms_room_ac_join_readings")
        .select("tenant_id, units_at_join")
        .eq("room_id", roomId)
        .eq("for_month", currentMonth)
        .eq("hostel_id", hostelId)
        .order("units_at_join", { ascending: true }),
      admin
        .from("hms_room_ac_checkout_readings")
        .select("meter_reading, tenant_count_at_checkout")
        .eq("room_id", roomId)
        .eq("for_month", currentMonth)
        .eq("hostel_id", hostelId)
        .order("meter_reading", { ascending: true }),
    ])

    // A failed tenant query returns null, which falls through to "No active
    // tenants found in this room" below — an answer about the room, for a
    // question the database never actually answered.
    if (allTenantsErr) return { error: `Could not read this room's tenants: ${allTenantsErr.message}` }

    if (!room) return { error: "Room not found." }
    if (!room.has_ac) return { error: "This room does not have AC." }

    const perUnitRate = Number(config?.ac_per_unit_rate ?? 0)
    if (perUnitRate <= 0) {
      return { error: "AC per-unit rate is not configured. Ask the owner to set it in Settings → Packages." }
    }
    const foodRate = Number(config?.food_monthly_rate ?? 0)
    // Room is already verified has_ac = true above, so AC maintenance applies
    // unconditionally here — same reasoning as applyRoomACUnitsAction.
    const acMaintenanceCharge = Number(config?.ac_maintenance_rate ?? 0)

    const eligible = allTenants ?? []
    if (eligible.length === 0) {
      return { error: "No active tenants found in this room." }
    }

    // No prev-month record and no explicit opening reading typed in? Fall back
    // to the earliest active tenant's move-in meter reading (captured once at
    // tenant creation) instead of assuming the meter started at 0.
    const derivedOpening = deriveOpeningReading(eligible, currentMonth)

    // Derive consumption from cumulative meter readings
    const prevReading = prevRecord?.meter_reading != null
      ? Math.round(Number(prevRecord.meter_reading))
      : (openingReading != null ? Math.round(Number(openingReading)) : (derivedOpening ?? 0))

    if (reading < prevReading)
      return { error: `Meter reading (${reading}) cannot be less than previous month's reading (${prevReading}).` }

    const units = reading - prevReading

    const { data: existingRows } = await admin
      .from("hms_payments")
      .select("tenant_id")
      .eq("hostel_id", hostelId)
      .eq("for_month", currentMonth)
      .in("tenant_id", eligible.map((t) => t.id))
    const existingIds = new Set((existingRows ?? []).map((r) => r.tenant_id))
    const missing = eligible.filter((t) => !existingIds.has(t.id))
    if (missing.length > 0) {
      // Fully priced, matching applyRoomACUnitsAction's missing-row insert — the
      // old stub (amount: 0, payment_package_tier hardcoded to "space_food_ac")
      // silently dropped registration_fee_charge/security_deposit_charge (the DB
      // trigger trusts these rather than re-deriving them) and mislabeled every
      // tenant's tier, whatever it actually was.
      const newRows = missing.map((t) => {
        const tier = (t.package_tier ?? "space_only") as PackageTier
        const billingInfo = {
          billing_type: t.billing_type ?? "monthly",
          monthly_rent: t.monthly_rent ?? 0,
          daily_rate: t.daily_rate ?? 0,
          check_in: t.check_in,
          check_out: t.check_out ?? null,
        }
        const baseRent = calcBaseRentServer(billingInfo, currentMonth)
        const daySnapshot = dailySnapshot(billingInfo, currentMonth)
        const tierFoodCharge = (tier === "space_food" || tier === "space_3meals" || tier === "space_food_ac" || tier === "space_meals_cooler") ? foodRate : 0
        const addonFoodCharge = config ? calcFoodAddonCharge(t, config) : 0
        const foodCharge = tierFoodCharge + addonFoodCharge
        const depositCharge = computeDepositCharge(
          { check_in: t.check_in, security_deposit: t.security_deposit, deposit_collected_amount: t.deposit_collected_amount ?? 0 },
          currentMonth
        )
        const registrationFeeCharge = computeRegistrationFeeCharge(
          { check_in: t.check_in, registration_fee: t.registration_fee },
          currentMonth
        )
        return {
          hostel_id: hostelId,
          tenant_id: t.id,
          for_month: currentMonth,
          amount: baseRent + foodCharge + depositCharge + registrationFeeCharge + acMaintenanceCharge,
          status: "pending" as PaymentStatus,
          payment_package_tier: tier,
          food_charge: foodCharge,
          ac_units_consumed: 0,
          ac_charge: 0,
          security_deposit_charge: depositCharge,
          registration_fee_charge: registrationFeeCharge,
          ac_maintenance_charge: acMaintenanceCharge,
          ...daySnapshot,
        }
      })
      await admin.from("hms_payments").insert(newRows)
    }

    // Shared with applyRoomACUnitsAction (lib/ac-billing.ts) so this tier can
    // never bill a mid-month joiner as if present the whole month — this path
    // used to split units equally regardless of join date.
    const { tenantBilling: billing, departedCounted } = computeACSegmentBilling({
      eligible,
      prevReading,
      reading,
      units,
      perUnitRate,
      forMonth: currentMonth,
      joinReadingsRaw: (joinReadingsRaw ?? []).filter((r) => eligible.some((t) => t.id === r.tenant_id)),
      // Passed through unfiltered — see applyRoomACUnitsAction for why a
      // departure at exactly this reading must reach the billing function.
      checkoutReadingsRaw: checkoutReadingsRaw ?? [],
    })

    // Update each tenant's payment row for this month
    const updateResults = await Promise.all(
      billing.map(({ id, tenantUnits, charge }) =>
        admin
          .from("hms_payments")
          .update({ ac_units_consumed: tenantUnits, ac_charge: charge, updated_at: new Date().toISOString() })
          .eq("tenant_id", id)
          .eq("for_month", currentMonth)
          .eq("hostel_id", hostelId)
      )
    )

    const firstError = updateResults.find((r) => r.error)?.error
    if (firstError) return { error: firstError.message }

    // Reopen bills that were settled before this reading and are now short by the
    // AC just applied — see applyRoomACUnitsAction for why "paid" with a balance
    // outstanding breaks every total that adds Collected + Pending.
    const { data: touchedRows } = await admin
      .from("hms_payments")
      .select("id, status, amount, late_fee, amount_paid")
      .eq("hostel_id", hostelId)
      .eq("for_month", currentMonth)
      .in("tenant_id", billing.map((b) => b.id))
    const nowUnderpaid = (touchedRows ?? []).filter(
      (r) => r.status === "paid" && r.amount_paid != null
        && Number(r.amount) + Number(r.late_fee ?? 0) - Number(r.amount_paid) > 0.01
    )
    if (nowUnderpaid.length > 0) {
      await admin
        .from("hms_payments")
        .update({ status: "partially_paid" as PaymentStatus, updated_at: new Date().toISOString() })
        .in("id", nowUnderpaid.map((r) => r.id))
        .eq("hostel_id", hostelId)
    }

    // Persist the room-level reading so the UI can show it on next load
    await admin
      .from("hms_room_ac_readings")
      .upsert(
        {
          hostel_id: hostelId,
          room_id: roomId,
          for_month: currentMonth,
          total_units: units,
          meter_reading: reading,
          per_unit_rate: perUnitRate,
          // Includes departures that shared the meter — see applyRoomACUnitsAction.
          tenant_count: eligible.length + departedCounted,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "room_id,for_month" }
      )

    revalidatePath("/portal/payments")
    const first = billing[0]
    return {
      error: null,
      eligibleCount: eligible.length,
      perTenantUnits: first?.tenantUnits ?? 0,
      perTenantCharge: first?.charge ?? 0,
      derivedUnits: units,
      prevMonthReading: prevReading,
      currentReading: reading,
    }
  } catch (err: unknown) {
    unstable_rethrow(err)
    return { error: err instanceof Error ? err.message : "An unexpected error occurred." }
  }
}

export async function saveACJoinReadingAsManager(
  roomId: string,
  forMonth: string,
  tenantId: string,
  joinMeterReading: number,
  openingReading?: number,
): Promise<{ error: string | null }> {
  try {
    const ctx = await requireManagerPermission("collect_payments")
    const hostelId = ctx.activeHostel.id
    const admin = createAdminClient()

    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(forMonth)) return { error: "Invalid month." }

    const joinReading = Math.round(Number(joinMeterReading))
    if (!Number.isFinite(joinReading) || joinReading < 0 || joinReading > 999_999)
      return { error: "Join meter reading must be between 0 and 999,999." }
    if (openingReading !== undefined) {
      const or = Math.round(Number(openingReading))
      if (!Number.isFinite(or) || or < 0 || or > 999_999) return { error: "Opening reading must be between 0 and 999,999." }
    }

    const prevMonthStr = getPrevMonth(forMonth)
    const [{ data: room }, { data: tenant }, { data: prevRecord }, { data: roommates }] = await Promise.all([
      admin.from("hms_rooms").select("id").eq("id", roomId).eq("hostel_id", hostelId).single(),
      admin.from("hms_tenants").select("id").eq("id", tenantId).eq("hostel_id", hostelId).eq("room_id", roomId).single(),
      admin.from("hms_room_ac_readings").select("meter_reading").eq("room_id", roomId).eq("hostel_id", hostelId).eq("for_month", prevMonthStr).maybeSingle(),
      admin.from("hms_tenants").select("check_in, joining_meter_reading").eq("hostel_id", hostelId).eq("room_id", roomId).eq("is_active", true),
    ])

    if (!room) return { error: "Room not found." }
    if (!tenant) return { error: "Tenant not found in this room." }

    // Same fallback as applyRoomACUnitsAsManager: derive from the room's
    // earliest known move-in reading rather than assuming the meter started at 0.
    const derivedOpening = deriveOpeningReading(roommates ?? [], forMonth)

    const prevReading = prevRecord?.meter_reading != null
      ? Math.round(Number(prevRecord.meter_reading))
      : (openingReading != null ? Math.round(Number(openingReading)) : (derivedOpening ?? 0))

    if (joinReading < prevReading)
      return { error: `Join meter reading (${joinReading}) cannot be less than previous month's reading (${prevReading}).` }

    const relativeUnitsAtJoin = joinReading - prevReading

    const { error } = await admin
      .from("hms_room_ac_join_readings")
      .upsert(
        {
          hostel_id: hostelId,
          room_id: roomId,
          for_month: forMonth,
          tenant_id: tenantId,
          units_at_join: relativeUnitsAtJoin,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "room_id,for_month,tenant_id" }
      )
    if (error) return { error: error.message }

    revalidatePath("/portal/payments")
    return { error: null }
  } catch (err: unknown) {
    unstable_rethrow(err)
    return { error: err instanceof Error ? err.message : "An unexpected error occurred." }
  }
}

// Full field parity with the owner's add tenant form — a manager holding
// add_members fills in exactly the same 25 fields, so this mirrors
// addTenantAsPartner rather than carrying a reduced subset of its own.
export type ManagerTenantPayload = PartnerTenantPayload

function validateManagerTenantPayload(payload: ManagerTenantPayload): string | null {
  if (!payload.full_name?.trim() || payload.full_name.trim().length < 2) {
    return "Full name must be at least 2 characters."
  }
  if (!payload.is_waiting && !payload.check_in) return "Check-in date is required."
  if (payload.cnic && !isValidCnic(normalizeCnic(payload.cnic))) {
    return "Invalid CNIC format. Must be XXXXX-XXXXXXX-X."
  }
  // Back-dated check-ins are rejected rather than silently accepted. The owner
  // flow generates arrears rows via backfillTenantPaymentsAction, but that
  // action requires full owner/partner tier, so for a manager it always no-ops
  // — the tenant would be created months in the past owing nothing, and the
  // branch would under-report receivables with nobody aware.
  if (!payload.is_waiting && payload.check_in) {
    // Pakistan-anchored, not the server process's own OS timezone — Vercel's
    // serverless functions default to UTC, which can silently disagree with
    // Pakistan on what "this month" is.
    const { year: curYear, month: curMonth } = pktYearMonth()
    const currentMonth = `${curYear}-${String(curMonth).padStart(2, "0")}`
    if (payload.check_in.slice(0, 7) < currentMonth) {
      return "Check-in date can't be in a previous month. Ask the owner to add a back-dated tenant so past dues are billed correctly."
    }
  }
  return null
}

// The back-dated check-in restriction above only makes sense at CREATION time
// (a brand-new tenant needs backfillTenantPaymentsAction, which no-ops for a
// manager). Reusing that validator for EDIT would reject saving any change to
// an already-existing tenant, since almost every real tenant's check_in date
// is already in a previous month — this is edit validation only, no back-dated
// restriction.
function validateManagerTenantEditPayload(payload: ManagerTenantPayload): string | null {
  if (!payload.full_name?.trim() || payload.full_name.trim().length < 2) {
    return "Full name must be at least 2 characters."
  }
  if (!payload.is_waiting && !payload.check_in) return "Check-in date is required."
  if (payload.cnic && !isValidCnic(normalizeCnic(payload.cnic))) {
    return "Invalid CNIC format. Must be XXXXX-XXXXXXX-X."
  }
  return null
}

export async function addTenantAsManager(
  payload: ManagerTenantPayload
): Promise<{ error: string | null; tenantId?: string }> {
  try {
    const ctx = await requireManagerPermission("add_members")
    const hostelId = ctx.activeHostel.id
    const admin = createAdminClient()

    const validationError = validateManagerTenantPayload(payload)
    if (validationError) return { error: validationError }

    const roomId = payload.is_waiting ? null : payload.room_id
    let room: { id: string; capacity: number; occupied: number } | null = null
    if (roomId) {
      const { data: r } = await admin
        .from("hms_rooms")
        .select("id, capacity, occupied, status")
        .eq("id", roomId)
        .eq("hostel_id", hostelId)
        .single()
      if (!r) return { error: "Invalid room selection." }
      if (r.status === "maintenance") return { error: "Selected room is under maintenance." }
      if (r.occupied >= r.capacity) return { error: "Selected room is at full capacity." }
      room = r
    }

    const billingType = payload.billing_type === "daily" ? "daily" : "monthly"
    const insertData: Record<string, unknown> = {
      hostel_id: hostelId,
      full_name: payload.full_name.trim(),
      phone: payload.phone?.trim() || null,
      email: payload.email?.trim() || null,
      cnic: normalizeCnic(payload.cnic),
      type: payload.type,
      package_tier: payload.package_tier,
      custom_package_id: payload.custom_package_id || null,
      room_id: roomId,
      bed_number: payload.bed_number || null,
      check_in: payload.is_waiting ? new Date().toISOString().slice(0, 10) : payload.check_in,
      check_out: billingType === "daily" && payload.check_out ? payload.check_out : null,
      billing_type: billingType,
      monthly_rent: billingType === "monthly" ? Number(payload.monthly_rent) || 0 : 0,
      daily_rate: billingType === "daily" ? Number(payload.daily_rate) || 0 : 0,
      security_deposit: Number(payload.security_deposit) || 0,
      registration_fee: Number(payload.registration_fee) || 0,
      vehicle_type: payload.vehicle_type?.trim() || null,
      vehicle_number: payload.vehicle_number?.trim() || null,
      vehicle_model: payload.vehicle_model?.trim() || null,
      joining_meter_reading: payload.joining_meter_reading ?? null,
      emergency_contact: payload.emergency_contact || null,
      emergency_relationship: payload.emergency_relationship || null,
      permanent_address: payload.permanent_address?.trim() || null,
      father_name: payload.father_name?.trim() || null,
      ...normalizeVisitPurpose(payload.purpose_of_visit, payload.purpose_of_visit_detail),
      emergency_phone: payload.emergency_phone || null,
      notes: payload.notes || null,
      is_waiting: payload.is_waiting,
      is_active: !payload.is_waiting,
      photo_url: payload.photo_url || null,
      food_breakfast: !!payload.food_breakfast,
      food_lunch: !!payload.food_lunch,
      food_dinner: !!payload.food_dinner,
      institute_name: payload.institute_name || null,
      student_category: payload.student_category || null,
      student_specialization: payload.student_specialization || null,
      organization: payload.organization || null,
      organization_type: payload.organization_type || null,
      department: payload.department || null,
    }

    const { data: created, error: insErr } = await admin
      .from("hms_tenants")
      .insert(insertData)
      .select("id")
      .single()
    if (insErr) return { error: insErr.message }
    const tenantId = created.id as string

    // Fire-and-forget welcome WhatsApp — never awaited, never blocks this action.
    if (!payload.is_waiting) {
      void sendTenantWelcomeMessageAction(tenantId)
    }

    if (room && roomId) {
      const newOccupied = room.occupied + 1
      await admin
        .from("hms_rooms")
        .update({ occupied: newOccupied, status: newOccupied >= room.capacity ? "occupied" : "available" })
        .eq("id", roomId)
        .eq("hostel_id", hostelId)
    }

    // Ledger entry — best-effort, mirrors the owner/partner flow exactly.
    const depositAmount = insertData.security_deposit as number
    if (depositAmount > 0) {
      await admin.from("hms_tenant_events").insert({
        hostel_id: hostelId,
        tenant_id: tenantId,
        event_type: "deposit_collected",
        amount: depositAmount,
      })
    }

    // Best-effort backfill for a historical check-in date. It re-authorizes
    // internally against the owner/partner path, so it silently no-ops for a
    // manager — same graceful degradation the partner flow already has, and it
    // never blocks tenant creation either way.
    if (!payload.is_waiting && payload.check_in) {
      const checkInMonth = payload.check_in.slice(0, 7)
      // Pakistan-anchored — see addTenantAsManager above for why.
      const { year: curYear, month: curMonth } = pktYearMonth()
      const currentMonth = `${curYear}-${String(curMonth).padStart(2, "0")}`
      if (checkInMonth < currentMonth) {
        try {
          await backfillTenantPaymentsAction(tenantId)
        } catch {
          // ignore — tenant is already created
        }
      }
    }

    // Same reason as the partner path — the new tenant needs a payment row, so
    // the payments route's cached payload is stale.
    revalidatePath("/portal/tenants")
    revalidatePath("/portal/payments")
    revalidatePath("/payments")

    // Attribution runs LAST, after every write that makes an admission complete
    // (room occupancy, deposit ledger, application status). try/catch bounds a
    // THROW, not TIME: supabase-js sets no fetch timeout, so a stalled query is an
    // unbounded await the catch never sees — the platform kills the invocation
    // instead. Sitting mid-sequence, that left the tenant row committed with
    // occupancy un-incremented and the application still pending, and the
    // operator's natural retry created a SECOND tenant. Last means a stall can
    // only ever cost the attribution.
    await linkReferralForNewTenant(admin, {
      tenantId,
      hostelId,
      phone: payload.phone,
      checkIn: payload.check_in,
    })

    return { error: null, tenantId }
  } catch (err: unknown) {
    unstable_rethrow(err)
    return { error: err instanceof Error ? err.message : "An unexpected error occurred." }
  }
}

// Mirrors editTenantAsPartner exactly (app/actions/partner.ts) — same field
// list, same room-swap/occupancy logic, same ledger events — just gated by
// edit_members instead of full-tier partnership.
export async function editTenantAsManager(
  tenantId: string,
  payload: ManagerTenantPayload
): Promise<{ error: string | null }> {
  try {
    const ctx = await requireManagerPermission("edit_members")
    const hostelId = ctx.activeHostel.id
    const admin = createAdminClient()

    const { data: existing } = await admin
      .from("hms_tenants")
      .select("id, hostel_id, room_id, package_tier, is_waiting")
      .eq("id", tenantId)
      .maybeSingle()

    if (!existing || existing.hostel_id !== hostelId) {
      return { error: "Tenant not found in your active branch." }
    }

    const validationError = validateManagerTenantEditPayload(payload)
    if (validationError) return { error: validationError }

    const prevRoomId = existing.room_id as string | null
    const roomId = payload.is_waiting ? null : payload.room_id
    let newRoom: { id: string; capacity: number; occupied: number } | null = null
    if (roomId && roomId !== prevRoomId) {
      const { data: r } = await admin
        .from("hms_rooms")
        .select("id, capacity, occupied, status")
        .eq("id", roomId)
        .eq("hostel_id", hostelId)
        .single()
      if (!r) return { error: "Invalid room selection." }
      if (r.status === "maintenance") return { error: "Selected room is under maintenance." }
      if (r.occupied >= r.capacity) return { error: "Selected room is at full capacity." }
      newRoom = r
    }

    const billingType = payload.billing_type === "daily" ? "daily" : "monthly"
    const updatePayload: Record<string, unknown> = {
      full_name: payload.full_name.trim(),
      phone: payload.phone?.trim() || null,
      email: payload.email?.trim() || null,
      cnic: normalizeCnic(payload.cnic),
      type: payload.type,
      package_tier: payload.package_tier,
      custom_package_id: payload.custom_package_id || null,
      room_id: roomId,
      bed_number: payload.bed_number || null,
      check_in: payload.is_waiting ? new Date().toISOString().slice(0, 10) : payload.check_in,
      check_out: billingType === "daily" && payload.check_out ? payload.check_out : null,
      billing_type: billingType,
      monthly_rent: billingType === "monthly" ? Number(payload.monthly_rent) || 0 : 0,
      daily_rate: billingType === "daily" ? Number(payload.daily_rate) || 0 : 0,
      security_deposit: Number(payload.security_deposit) || 0,
      registration_fee: Number(payload.registration_fee) || 0,
      vehicle_type: payload.vehicle_type?.trim() || null,
      vehicle_number: payload.vehicle_number?.trim() || null,
      vehicle_model: payload.vehicle_model?.trim() || null,
      joining_meter_reading: payload.joining_meter_reading ?? null,
      emergency_contact: payload.emergency_contact || null,
      emergency_relationship: payload.emergency_relationship || null,
      permanent_address: payload.permanent_address?.trim() || null,
      father_name: payload.father_name?.trim() || null,
      ...normalizeVisitPurpose(payload.purpose_of_visit, payload.purpose_of_visit_detail),
      emergency_phone: payload.emergency_phone || null,
      notes: payload.notes || null,
      is_waiting: payload.is_waiting,
      is_active: !payload.is_waiting,
      photo_url: payload.photo_url || null,
      food_breakfast: !!payload.food_breakfast,
      food_lunch: !!payload.food_lunch,
      food_dinner: !!payload.food_dinner,
      institute_name: payload.institute_name || null,
      student_category: payload.student_category || null,
      student_specialization: payload.student_specialization || null,
      organization: payload.organization || null,
      organization_type: payload.organization_type || null,
      department: payload.department || null,
    }

    const { error } = await admin
      .from("hms_tenants")
      .update(updatePayload)
      .eq("id", tenantId)
      .eq("hostel_id", hostelId)

    if (error) return { error: error.message }

    // Fire-and-forget welcome WhatsApp — only on the waiting-list → active
    // transition, not on every routine edit of an already-active tenant.
    if (existing.is_waiting && !payload.is_waiting) {
      void sendTenantWelcomeMessageAction(tenantId)
    }

    // Moving an already-active tenant back to the waiting list leaves behind
    // any payment row already generated for them — they were never actually
    // billable, unlike a genuinely checked-out tenant. Only this month/later,
    // and only rows nothing has been paid against yet.
    if (!existing.is_waiting && payload.is_waiting) {
      const currentMonth = new Date().toISOString().slice(0, 7)
      await admin.from("hms_payments")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("hostel_id", hostelId)
        .gte("for_month", currentMonth)
        .in("status", ["pending", "overdue"])
    }

    // Ledger events — best-effort, mirrors the owner/partner flow exactly.
    if (prevRoomId !== roomId) {
      const [{ data: oldRoomRow }, { data: newRoomRow }] = await Promise.all([
        prevRoomId ? admin.from("hms_rooms").select("room_number").eq("id", prevRoomId).maybeSingle() : Promise.resolve({ data: null }),
        roomId ? admin.from("hms_rooms").select("room_number").eq("id", roomId).maybeSingle() : Promise.resolve({ data: null }),
      ])
      await logTenantEvent({
        tenantId,
        eventType: "room_changed",
        fromValue: oldRoomRow?.room_number ?? "None",
        toValue: newRoomRow?.room_number ?? "None",
      })
    }
    if (existing.package_tier !== payload.package_tier) {
      await logTenantEvent({
        tenantId,
        eventType: "plan_changed",
        fromValue: existing.package_tier ?? null,
        toValue: payload.package_tier,
      })
    }

    // Room occupancy adjustments — old room decrements, new room increments.
    if (prevRoomId !== roomId) {
      if (prevRoomId) {
        const { data: oldRoom } = await admin.from("hms_rooms").select("occupied, capacity").eq("id", prevRoomId).single()
        if (oldRoom) {
          const newOcc = Math.max(0, oldRoom.occupied - 1)
          await admin
            .from("hms_rooms")
            .update({ occupied: newOcc, status: newOcc < oldRoom.capacity ? "available" : "occupied" })
            .eq("id", prevRoomId)
        }
      }
      if (roomId && newRoom) {
        const newOcc = newRoom.occupied + 1
        await admin
          .from("hms_rooms")
          .update({ occupied: newOcc, status: newOcc >= newRoom.capacity ? "occupied" : "available" })
          .eq("id", roomId)
      }
    }

    revalidatePath("/portal/tenants")
    revalidatePath("/portal/payments")
    return { error: null }
  } catch (err: unknown) {
    unstable_rethrow(err)
    return { error: err instanceof Error ? err.message : "An unexpected error occurred." }
  }
}

// Mirrors giveTenantNoticeAction/cancelTenantNoticeAction (app/actions/tenants.ts)
// — same validation, same hms_tenant_events logging — gated by edit_members
// since giving/cancelling notice is a variant of editing a tenant's record,
// not a separate capability of its own.
export async function giveTenantNoticeAsManager(
  tenantId: string,
  intendedCheckoutDate: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const ctx = await requireManagerPermission("edit_members")
    const hostelId = ctx.activeHostel.id
    const admin = createAdminClient()

    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
    if (!DATE_RE.test(intendedCheckoutDate)) throw new Error("Invalid date format")
    const dateObj = new Date(intendedCheckoutDate + "T00:00:00")
    if (isNaN(dateObj.getTime())) throw new Error("Invalid date")
    const today = new Date().toISOString().slice(0, 10)
    if (intendedCheckoutDate < today) throw new Error("Intended checkout date cannot be in the past")

    const { data: tenant, error: tenantErr } = await admin
      .from("hms_tenants")
      .select("id, is_active")
      .eq("id", tenantId)
      .eq("hostel_id", hostelId)
      .single()
    if (tenantErr || !tenant) throw new Error("Tenant not found or access denied")
    if (!tenant.is_active) throw new Error("Tenant is not active")

    const { error } = await admin
      .from("hms_tenants")
      .update({ notice_given_date: today, intended_checkout_date: intendedCheckoutDate, leaving_reminder_sent_at: null })
      .eq("id", tenantId)
      .eq("hostel_id", hostelId)
    if (error) throw new Error("Failed to record notice.")

    await admin.from("hms_tenant_events").insert({
      hostel_id: hostelId,
      tenant_id: tenantId,
      event_type: "notice_given",
      to_value: intendedCheckoutDate,
    })

    revalidatePath("/portal/tenants")
    return { success: true }
  } catch (err: unknown) {
    unstable_rethrow(err)
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function cancelTenantNoticeAsManager(
  tenantId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const ctx = await requireManagerPermission("edit_members")
    const hostelId = ctx.activeHostel.id
    const admin = createAdminClient()

    const { data: tenant, error: tenantErr } = await admin
      .from("hms_tenants")
      .select("id, is_active, intended_checkout_date")
      .eq("id", tenantId)
      .eq("hostel_id", hostelId)
      .single()
    if (tenantErr || !tenant) throw new Error("Tenant not found or access denied")
    if (!tenant.is_active) throw new Error("Tenant is not active")

    const { error } = await admin
      .from("hms_tenants")
      .update({ notice_given_date: null, intended_checkout_date: null, leaving_reminder_sent_at: null })
      .eq("id", tenantId)
      .eq("hostel_id", hostelId)
    if (error) throw new Error("Failed to cancel notice.")

    await admin.from("hms_tenant_events").insert({
      hostel_id: hostelId,
      tenant_id: tenantId,
      event_type: "notice_cancelled",
      from_value: tenant.intended_checkout_date,
    })

    revalidatePath("/portal/tenants")
    return { success: true }
  } catch (err: unknown) {
    unstable_rethrow(err)
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// Checkout has no separate manager permission of its own — it's a variant of
// editing a tenant's record (ends their stay), so it's gated the same as edit.
// No delete permission exists for managers at all; checkout (not delete) is
// the only way a manager can end a tenancy.
export async function checkoutTenantAsManager(
  input: CheckoutInput
): Promise<{ success: boolean; error?: string; warning?: string; settlement?: CheckoutSettlement }> {
  try {
    const ctx = await requireManagerPermission("edit_members")
    const hostelId = ctx.activeHostel.id
    return await performTenantCheckout(hostelId, input)
  } catch (err: unknown) {
    unstable_rethrow(err)
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function recordPaymentAsManager(
  tenantId: string,
  amount: number,
  method: string,
  month: string,
  acUnitsConsumed?: number,
): Promise<{ payment?: Payment; installmentId?: string; error: string | null }> {
  try {
    const ctx = await requireManagerPermission("collect_payments")
    const hostelId = ctx.activeHostel.id
    const admin = createAdminClient()

    const VALID_METHODS = new Set(["cash", "bank_transfer", "jazzcash", "easypaisa", "sadapay", "other"])
    if (!VALID_METHODS.has(method)) return { error: "Invalid payment method." }
    if (!Number.isFinite(amount) || amount <= 0) return { error: "Invalid payment amount." }
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return { error: "Invalid month." }
    const currentMonth = new Date().toISOString().slice(0, 7)
    if (month !== currentMonth) return { error: "Payments can only be recorded for the current month." }

    // Verify tenant belongs to the active hostel and get their package tier
    const { data: tenant } = await admin
      .from("hms_tenants")
      .select("hostel_id, package_tier")
      .eq("id", tenantId)
      .maybeSingle()

    if (!tenant || tenant.hostel_id !== hostelId) {
      return { error: "Tenant not found in your active hostel." }
    }

    const isAcTier = tenant.package_tier === "space_food_ac"

    // Fetch the actual outstanding bill so the manager's entered amount is
    // validated against it — a manager can no longer type in any number and
    // have it silently accepted as "paid in full" regardless of the real total.
    const { data: existingPayment } = await admin
      .from("hms_payments")
      .select("id, amount, amount_paid, late_fee, ac_charge, status")
      .eq("tenant_id", tenantId)
      .eq("hostel_id", hostelId)
      .eq("for_month", month)
      .in("status", ["pending", "overdue", "partially_paid"])
      .maybeSingle()

    if (!existingPayment) {
      return { error: "No outstanding bill found for this tenant this month." }
    }

    let newAcCharge = Number(existingPayment.ac_charge ?? 0)
    const updatePayload: Record<string, unknown> = {
      payment_method: method,
      payment_date: new Date().toISOString().slice(0, 10),
    }

    if (isAcTier && acUnitsConsumed !== undefined) {
      // ac_units_consumed is numeric(10,2) — a room's units rarely split into
      // whole numbers per tenant, so allow up to 2 decimal places.
      if (!Number.isFinite(acUnitsConsumed) || acUnitsConsumed < 0 || acUnitsConsumed > 9999) {
        return { error: "AC units must be a non-negative number between 0 and 9999." }
      }
      const roundedUnits = Math.round(acUnitsConsumed * 100) / 100
      // Fetch AC rate from DB — never trust the client-supplied value
      const { data: config } = await admin
        .from("hms_package_configs")
        .select("ac_per_unit_rate")
        .eq("hostel_id", hostelId)
        .maybeSingle()

      const acUnitRate = Number(config?.ac_per_unit_rate ?? 0)
      newAcCharge = Math.round(roundedUnits * acUnitRate)
      updatePayload.ac_units_consumed = roundedUnits
      updatePayload.ac_charge = newAcCharge
    }

    // The bill's non-AC portion (rent + food + deposit, whatever it already was)
    // stays fixed here; only the AC charge can shift, if a fresh meter reading
    // was entered above. This mirrors what the DB trigger will recompute.
    const nonAcPortion = Number(existingPayment.amount) - Number(existingPayment.ac_charge ?? 0)
    const fullAmountDue = nonAcPortion + newAcCharge + Number(existingPayment.late_fee ?? 0)
    const previousAmountPaid = Number(existingPayment.amount_paid ?? 0)
    const remainingBefore = Math.max(0, fullAmountDue - previousAmountPaid)

    if (amount > remainingBefore + 0.01) {
      return {
        error: `Amount collected (Rs. ${amount.toLocaleString()}) exceeds the remaining balance (Rs. ${remainingBefore.toLocaleString()}). Enter the exact remaining amount instead.`,
      }
    }

    const newAmountPaid = previousAmountPaid + amount
    const isFullyPaid = newAmountPaid >= fullAmountDue - 0.01
    updatePayload.status = isFullyPaid ? "paid" : "partially_paid"
    updatePayload.amount_paid = newAmountPaid

    const { data: updated, error } = await admin
      .from("hms_payments")
      .update(updatePayload)
      .eq("id", existingPayment.id)
      .eq("hostel_id", hostelId)
      // Return the updated row so the caller can drive the post-payment receipt
      // dialog, matching recordPaymentAsPartner.
      .select("*, tenant:hms_tenants(full_name, room_id, phone)")
      .single()

    if (error) return { error: error.message }

    // Record this transaction as its own immutable snapshot, same as the
    // owner-facing payment flow — so a manager-collected installment shows up
    // in the Member Ledger/timeline as its own event, not silently merged in.
    const { data: installmentRow, error: installmentErr } = await admin.from("hms_payment_installments").insert({
      hostel_id: hostelId,
      tenant_id: tenantId,
      payment_id: existingPayment.id,
      for_month: month,
      amount,
      amount_before: previousAmountPaid,
      amount_after: newAmountPaid,
      total_due: fullAmountDue,
      payment_method: method,
      payment_date: new Date().toISOString().slice(0, 10),
    }).select("id").single()
    if (installmentErr) {
      console.error("[recordPaymentAsManager] Failed to record payment installment:", installmentErr.message)
    }

    revalidatePath("/portal/payments")
    revalidatePath("/payments")
    return {
      payment: updated as Payment,
      installmentId: installmentRow?.id as string | undefined,
      error: null,
    }
  } catch (err: unknown) {
    unstable_rethrow(err)
    return { error: err instanceof Error ? err.message : "An unexpected error occurred." }
  }
}

export async function addExpenseAsManager(
  category: string,
  amount: number,
  description: string,
  date: string,
  notes?: string,
): Promise<{ error: string | null }> {
  try {
    const ctx = await requireManagerPermission("add_expenses")
    const hostelId = ctx.activeHostel.id
    const admin = createAdminClient()

    const VALID_CATEGORIES = new Set(["furniture", "repairs", "cleaning", "security", "utilities", "other"])
    if (!VALID_CATEGORIES.has(category)) return { error: "Invalid expense category." }
    if (!Number.isFinite(amount) || amount <= 0) return { error: "Amount must be greater than 0." }
    if (!description?.trim()) return { error: "Description is required." }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Invalid date." }

    const { error } = await admin.from("hms_expenses").insert({
      hostel_id: hostelId,
      title: description.trim(),
      amount,
      category,
      date,
      // Was hardcoded null while the reused owner form still rendered a Notes
      // textarea — a manager's explanation of the expense was accepted and then
      // silently dropped from the financial record.
      notes: notes?.trim() || null,
    })

    if (error) return { error: error.message }

    revalidatePath("/portal/expenses")
    return { error: null }
  } catch (err: unknown) {
    unstable_rethrow(err)
    return { error: err instanceof Error ? err.message : "An unexpected error occurred." }
  }
}

// Edit only — no deleteExpenseAsManager exists. Delete stays owner-only.
export async function updateExpenseAsManager(
  expenseId: string,
  category: string,
  amount: number,
  description: string,
  date: string,
  notes?: string,
): Promise<{ error: string | null }> {
  try {
    const ctx = await requireManagerPermission("edit_expenses")
    const hostelId = ctx.activeHostel.id
    const admin = createAdminClient()

    const VALID_CATEGORIES = new Set(["furniture", "repairs", "cleaning", "security", "utilities", "other"])
    if (!VALID_CATEGORIES.has(category)) return { error: "Invalid expense category." }
    if (!Number.isFinite(amount) || amount <= 0) return { error: "Amount must be greater than 0." }
    if (!description?.trim()) return { error: "Description is required." }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Invalid date." }

    const { data: updated, error } = await admin
      .from("hms_expenses")
      .update({
        title: description.trim(),
        amount,
        category,
        date,
        notes: notes?.trim() || null,
      })
      .eq("id", expenseId)
      .eq("hostel_id", hostelId)
      .select("id")
      .maybeSingle()

    if (error) return { error: error.message }
    if (!updated) return { error: "Expense not found in your active hostel." }

    revalidatePath("/portal/expenses")
    return { error: null }
  } catch (err: unknown) {
    unstable_rethrow(err)
    return { error: err instanceof Error ? err.message : "An unexpected error occurred." }
  }
}

export async function addKitchenDailyItemsAsManager(
  items: { title: string; quantity: string | null; amount: number }[],
  date: string,
): Promise<{ error: string | null }> {
  try {
    const ctx = await requireManagerPermission("add_kitchen_expenses")
    const hostelId = ctx.activeHostel.id
    const admin = createAdminClient()

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Invalid date." }

    const valid = items.filter((i) => i.title?.trim() && Number.isFinite(i.amount) && i.amount > 0)
    if (!valid.length) return { error: "Add at least one valid item." }

    const { error } = await admin.from("hms_kitchen_expenses").insert(
      valid.map((i) => ({
        hostel_id: hostelId,
        title: i.title.trim(),
        quantity: i.quantity || null,
        amount: i.amount,
        date,
        type: "daily",
        notes: null,
      })),
    )

    if (error) return { error: error.message }

    revalidatePath("/portal/kitchen")
    return { error: null }
  } catch (err: unknown) {
    unstable_rethrow(err)
    return { error: err instanceof Error ? err.message : "An unexpected error occurred." }
  }
}

// Shared by both the daily-entry Edit dialog and the grocery Edit dialog —
// both operate on the same hms_kitchen_expenses row shape, and neither needs
// to change `type` on an existing row. Edit only — no delete action exists.
export async function updateKitchenItemAsManager(
  itemId: string,
  title: string,
  quantity: string | null,
  amount: number,
  date: string,
  notes?: string,
): Promise<{ error: string | null }> {
  try {
    const ctx = await requireManagerPermission("edit_kitchen_expenses")
    const hostelId = ctx.activeHostel.id
    const admin = createAdminClient()

    if (!title?.trim()) return { error: "Item name is required." }
    if (!Number.isFinite(amount) || amount <= 0) return { error: "Amount must be greater than 0." }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Invalid date." }

    const { data: updated, error } = await admin
      .from("hms_kitchen_expenses")
      .update({
        title: title.trim(),
        quantity: quantity || null,
        amount,
        date,
        notes: notes?.trim() || null,
      })
      .eq("id", itemId)
      .eq("hostel_id", hostelId)
      .select("id")
      .maybeSingle()

    if (error) return { error: error.message }
    if (!updated) return { error: "Kitchen item not found in your active hostel." }

    revalidatePath("/portal/kitchen")
    return { error: null }
  } catch (err: unknown) {
    unstable_rethrow(err)
    return { error: err instanceof Error ? err.message : "An unexpected error occurred." }
  }
}

export async function addKitchenGroceryItemAsManager(
  title: string,
  quantity: string | null,
  amount: number,
  date: string,
  notes?: string,
): Promise<{ error: string | null }> {
  try {
    const ctx = await requireManagerPermission("add_kitchen_expenses")
    const hostelId = ctx.activeHostel.id
    const admin = createAdminClient()

    if (!title?.trim()) return { error: "Item name is required." }
    if (!Number.isFinite(amount) || amount <= 0) return { error: "Amount must be greater than 0." }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Invalid date." }

    const { error } = await admin.from("hms_kitchen_expenses").insert({
      hostel_id: hostelId,
      title: title.trim(),
      quantity: quantity || null,
      amount,
      date,
      type: "monthly_grocery",
      notes: notes?.trim() || null,
    })

    if (error) return { error: error.message }

    revalidatePath("/portal/kitchen")
    return { error: null }
  } catch (err: unknown) {
    unstable_rethrow(err)
    return { error: err instanceof Error ? err.message : "An unexpected error occurred." }
  }
}

// ── Rooms/Spaces — manage_rooms bundles add + edit, no delete ──────────────
// Managers have no client-side storage RLS grant (mirrors the no-RLS-read
// pattern the rest of this file already relies on), so photo upload happens
// here via the admin (service-role) storage client instead of the owner's
// direct browser `supabase.storage.from(...).upload()` call.

const ROOM_PHOTO_FIELDS = ["photo_path", "photo_path_2", "photo_path_3", "photo_path_4", "photo_path_5"] as const
const ROOM_PHOTO_SUFFIXES = ["", "_2", "_3", "_4", "_5"] as const

function extractRoomFields(formData: FormData) {
  const floorRaw = formData.get("floor")
  return {
    room_number: String(formData.get("room_number") ?? "").trim(),
    floor: floorRaw ? parseInt(String(floorRaw)) : null,
    type: String(formData.get("type") ?? "general"),
    capacity: parseInt(String(formData.get("capacity") ?? "1")) || 1,
    status: String(formData.get("status") ?? "available"),
    has_ac: formData.get("has_ac") === "true",
    has_cooler: formData.get("has_cooler") === "true",
    has_attached_washroom: formData.get("has_attached_washroom") === "true",
  }
}

async function applyRoomPhotosAsManager(
  admin: ReturnType<typeof createAdminClient>,
  hostelId: string,
  roomId: string,
  formData: FormData,
): Promise<void> {
  const dbUpdate: Record<string, string | null> = {}

  await Promise.all(ROOM_PHOTO_FIELDS.map(async (field, i) => {
    const suffix = ROOM_PHOTO_SUFFIXES[i]
    const file = formData.get(`photo_${i}`) as File | null
    const cleared = formData.get(`photo_${i}_cleared`) === "true"

    if (file && file.size > 0) {
      if (file.size > 5 * 1024 * 1024) return // silently skipped — the client already enforces this limit
      const fname = file.name.toLowerCase()
      const ext = fname.endsWith(".png") ? "png" : fname.endsWith(".webp") ? "webp" : "jpg"
      const contentType = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg"
      const path = `${hostelId}/${roomId}${suffix}.${ext}`
      const { error } = await admin.storage.from("room-photos").upload(path, file, { upsert: true, contentType })
      if (!error) {
        const { data: { publicUrl } } = admin.storage.from("room-photos").getPublicUrl(path)
        dbUpdate[field] = publicUrl
      }
    } else if (cleared) {
      const exts = ["jpg", "jpeg", "png", "webp"]
      await Promise.all(exts.map((ext) => admin.storage.from("room-photos").remove([`${hostelId}/${roomId}${suffix}.${ext}`])))
      dbUpdate[field] = null
    }
  }))

  if (Object.keys(dbUpdate).length > 0) {
    await admin.from("hms_rooms").update(dbUpdate).eq("id", roomId).eq("hostel_id", hostelId)
  }
}

export async function addRoomAsManager(
  formData: FormData,
): Promise<{ error: string | null; roomId?: string }> {
  try {
    const ctx = await requireManagerPermission("manage_rooms")
    const hostelId = ctx.activeHostel.id
    const admin = createAdminClient()

    const fields = extractRoomFields(formData)
    if (!fields.room_number) return { error: "Room number is required." }

    const { data: inserted, error } = await admin
      .from("hms_rooms")
      .insert({ hostel_id: hostelId, ...fields })
      .select("id")
      .single()

    if (error || !inserted) return { error: error?.message ?? "Failed to create room." }

    await applyRoomPhotosAsManager(admin, hostelId, inserted.id, formData)

    revalidatePath("/portal/rooms")
    return { error: null, roomId: inserted.id }
  } catch (err: unknown) {
    unstable_rethrow(err)
    return { error: err instanceof Error ? err.message : "An unexpected error occurred." }
  }
}

export async function updateRoomAsManager(
  roomId: string,
  formData: FormData,
): Promise<{ error: string | null }> {
  try {
    const ctx = await requireManagerPermission("manage_rooms")
    const hostelId = ctx.activeHostel.id
    const admin = createAdminClient()

    const fields = extractRoomFields(formData)
    if (!fields.room_number) return { error: "Room number is required." }

    const { data: updated, error } = await admin
      .from("hms_rooms")
      .update(fields)
      .eq("id", roomId)
      .eq("hostel_id", hostelId)
      .select("id")
      .maybeSingle()

    if (error) return { error: error.message }
    if (!updated) return { error: "Room not found in your active hostel." }

    await applyRoomPhotosAsManager(admin, hostelId, roomId, formData)

    revalidatePath("/portal/rooms")
    return { error: null }
  } catch (err: unknown) {
    unstable_rethrow(err)
    return { error: err instanceof Error ? err.message : "An unexpected error occurred." }
  }
}
