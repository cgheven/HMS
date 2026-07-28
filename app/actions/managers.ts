"use server"

import { randomBytes } from "crypto"
import { revalidatePath } from "next/cache"
import { unstable_rethrow } from "next/navigation"
import { requireOwnerOrAbove } from "@/lib/auth"
import { getAuthContext } from "@/lib/data"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireManagerPermission } from "@/lib/manager-auth"
import { logActivity } from "@/lib/audit"
import { backfillTenantPaymentsAction } from "@/app/actions/tenants"
import { sendTenantWelcomeMessageAction } from "@/lib/whatsapp-welcome-action"
import type { PartnerTenantPayload } from "@/app/actions/partner"
import type { Manager, Payment, StaffPermission } from "@/types"

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

  const VALID_PERMISSIONS = new Set<StaffPermission>(["add_members", "collect_payments", "add_expenses"])
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

    // Verify room, get config, and fetch previous month reading in parallel
    const [{ data: room }, { data: config }, { data: prevRecord }] = await Promise.all([
      admin.from("hms_rooms").select("id, has_ac").eq("id", roomId).eq("hostel_id", hostelId).single(),
      admin.from("hms_package_configs").select("ac_per_unit_rate").eq("hostel_id", hostelId).maybeSingle(),
      admin.from("hms_room_ac_readings").select("meter_reading").eq("room_id", roomId).eq("hostel_id", hostelId).eq("for_month", prevMonthStr).maybeSingle(),
    ])

    if (!room) return { error: "Room not found." }
    if (!room.has_ac) return { error: "This room does not have AC." }

    const perUnitRate = Number(config?.ac_per_unit_rate ?? 0)
    if (perUnitRate <= 0) {
      return { error: "AC per-unit rate is not configured. Ask the owner to set it in Settings → Packages." }
    }

    // Derive consumption from cumulative meter readings
    const prevReading = prevRecord?.meter_reading != null
      ? Math.round(Number(prevRecord.meter_reading))
      : (openingReading != null ? Math.round(Number(openingReading)) : 0)

    if (reading < prevReading)
      return { error: `Meter reading (${reading}) cannot be less than previous month's reading (${prevReading}).` }

    const units = reading - prevReading

    // Fetch active tenants and checkout readings in parallel
    const [{ data: allTenants }, { data: checkoutReadingsRaw }] = await Promise.all([
      admin
        .from("hms_tenants")
        .select("id")
        .eq("hostel_id", hostelId)
        .eq("room_id", roomId)
        .eq("is_active", true),
      admin
        .from("hms_room_ac_checkout_readings")
        .select("meter_reading, tenant_count_at_checkout")
        .eq("room_id", roomId)
        .eq("for_month", currentMonth)
        .eq("hostel_id", hostelId)
        .order("meter_reading", { ascending: true }),
    ])

    const eligible = allTenants ?? []
    if (eligible.length === 0) {
      return { error: "No active tenants found in this room." }
    }

    const rawCheckoutReadings = checkoutReadingsRaw ?? []
    const conflictingCheckout = rawCheckoutReadings.find(
      (cr) => Math.round(Number(cr.meter_reading)) >= reading
    )
    if (conflictingCheckout) {
      return {
        error:
          `Month-end reading (${reading}) must be greater than all checkout readings. ` +
          `Found a checkout reading of ${Math.round(Number(conflictingCheckout.meter_reading))} — ` +
          `please verify the meter reading is correct.`,
      }
    }

    const checkoutSegments = rawCheckoutReadings
      .map((cr) => ({
        unitsOffset: Math.max(0, Math.round(Number(cr.meter_reading) - prevReading)),
        tenantCount: Number(cr.tenant_count_at_checkout),
      }))
      .filter((cr) => cr.unitsOffset > 0 && cr.unitsOffset < units)

    const { data: existingRows } = await admin
      .from("hms_payments")
      .select("tenant_id")
      .eq("hostel_id", hostelId)
      .eq("for_month", currentMonth)
      .in("tenant_id", eligible.map((t) => t.id))
    const existingIds = new Set((existingRows ?? []).map((r) => r.tenant_id))
    const missing = eligible.filter((t) => !existingIds.has(t.id))
    if (missing.length > 0) {
      await admin.from("hms_payments").insert(
        missing.map((t) => ({
          hostel_id: hostelId,
          tenant_id: t.id,
          for_month: currentMonth,
          amount: 0,
          status: "pending",
          payment_package_tier: "space_food_ac",
          ac_units_consumed: 0,
          ac_charge: 0,
        }))
      )
    }

    const n = eligible.length
    let billing: { id: string; tenantUnits: number; charge: number }[]

    if (checkoutSegments.length > 0) {
      // Period-based billing: departed tenants already paid their share.
      // Compute each active tenant's proportional units across all periods.
      const boundaries = [0, ...checkoutSegments.map((cr) => cr.unitsOffset), units]
      let perTenantFractionalUnits = 0

      for (let i = 0; i < boundaries.length - 1; i++) {
        const segUnits = boundaries[i + 1] - boundaries[i]
        if (segUnits <= 0) continue
        const count = i < checkoutSegments.length ? checkoutSegments[i].tenantCount : eligible.length
        if (count > 0) perTenantFractionalUnits += segUnits / count
      }

      const activeTotalUnits = Math.round(perTenantFractionalUnits * n)
      const activeTotalCharge = Math.round(perTenantFractionalUnits * n * perUnitRate)
      const baseUnits = n > 1 ? Math.floor(activeTotalUnits / n) : activeTotalUnits
      const lastUnits = activeTotalUnits - baseUnits * (n - 1)
      const baseCharge = n > 1 ? Math.floor(activeTotalCharge / n) : activeTotalCharge
      const lastCharge = activeTotalCharge - baseCharge * (n - 1)

      billing = eligible.map((t, idx) => ({
        id: t.id,
        tenantUnits: idx === n - 1 ? lastUnits : baseUnits,
        charge: idx === n - 1 ? lastCharge : baseCharge,
      }))
    } else {
      const totalCharge = Math.round(units * perUnitRate)
      const baseUnits  = n > 1 ? Math.floor(units / n)       : units
      const lastUnits  = units - baseUnits * (n - 1)
      const baseCharge = n > 1 ? Math.floor(totalCharge / n) : totalCharge
      const lastCharge = totalCharge - baseCharge * (n - 1)

      billing = eligible.map((t, idx) => ({
        id: t.id,
        tenantUnits: idx === n - 1 ? lastUnits  : baseUnits,
        charge:      idx === n - 1 ? lastCharge : baseCharge,
      }))
    }

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
          tenant_count: eligible.length,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "room_id,for_month" }
      )

    revalidatePath("/portal/payments")
    const first = billing[0]
    return {
      error: null,
      eligibleCount: n,
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
    const [{ data: room }, { data: tenant }, { data: prevRecord }] = await Promise.all([
      admin.from("hms_rooms").select("id").eq("id", roomId).eq("hostel_id", hostelId).single(),
      admin.from("hms_tenants").select("id").eq("id", tenantId).eq("hostel_id", hostelId).eq("room_id", roomId).single(),
      admin.from("hms_room_ac_readings").select("meter_reading").eq("room_id", roomId).eq("hostel_id", hostelId).eq("for_month", prevMonthStr).maybeSingle(),
    ])

    if (!room) return { error: "Room not found." }
    if (!tenant) return { error: "Tenant not found in this room." }

    const prevReading = prevRecord?.meter_reading != null
      ? Math.round(Number(prevRecord.meter_reading))
      : (openingReading != null ? Math.round(Number(openingReading)) : 0)

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
  if (payload.cnic && !/^\d{5}-\d{7}-\d$/.test(payload.cnic)) {
    return "Invalid CNIC format. Must be XXXXX-XXXXXXX-X."
  }
  // Back-dated check-ins are rejected rather than silently accepted. The owner
  // flow generates arrears rows via backfillTenantPaymentsAction, but that
  // action requires full owner/partner tier, so for a manager it always no-ops
  // — the tenant would be created months in the past owing nothing, and the
  // branch would under-report receivables with nobody aware.
  if (!payload.is_waiting && payload.check_in) {
    const now = new Date()
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
    if (payload.check_in.slice(0, 7) < currentMonth) {
      return "Check-in date can't be in a previous month. Ask the owner to add a back-dated tenant so past dues are billed correctly."
    }
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
      cnic: payload.cnic || null,
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
      joining_meter_reading: payload.joining_meter_reading ?? null,
      emergency_contact: payload.emergency_contact || null,
      emergency_relationship: payload.emergency_relationship || null,
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
      const now = new Date()
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
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
    return { error: null, tenantId }
  } catch (err: unknown) {
    unstable_rethrow(err)
    return { error: err instanceof Error ? err.message : "An unexpected error occurred." }
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
      if (!Number.isInteger(acUnitsConsumed) || acUnitsConsumed < 0 || acUnitsConsumed > 9999) {
        return { error: "AC units must be a whole number between 0 and 9999." }
      }
      // Fetch AC rate from DB — never trust the client-supplied value
      const { data: config } = await admin
        .from("hms_package_configs")
        .select("ac_per_unit_rate")
        .eq("hostel_id", hostelId)
        .maybeSingle()

      const acUnitRate = Number(config?.ac_per_unit_rate ?? 0)
      newAcCharge = acUnitsConsumed * acUnitRate
      updatePayload.ac_units_consumed = acUnitsConsumed
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
