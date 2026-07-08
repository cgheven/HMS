"use server"

import { randomBytes } from "crypto"
import { revalidatePath } from "next/cache"
import { requireOwnerOrAbove } from "@/lib/auth"
import { getAuthContext } from "@/lib/data"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireManagerPermission } from "@/lib/manager-auth"
import type { Manager, StaffPermission } from "@/types"

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
  totalUnits: number,
): Promise<{ error: string | null; eligibleCount?: number; perTenantUnits?: number; perTenantCharge?: number }> {
  try {
    const ctx = await requireManagerPermission("collect_payments")
    const hostelId = ctx.activeHostel.id
    const admin = createAdminClient()

    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(forMonth)) return { error: "Invalid month." }

    const units = Number(totalUnits)
    if (!Number.isFinite(units) || units < 0 || units > 99_999) {
      return { error: "Total units must be between 0 and 99,999." }
    }

    const currentMonth = forMonth

    // Verify room belongs to this hostel and has AC
    const { data: room } = await admin
      .from("hms_rooms")
      .select("id, has_ac")
      .eq("id", roomId)
      .eq("hostel_id", hostelId)
      .single()

    if (!room) return { error: "Room not found." }
    if (!room.has_ac) return { error: "This room does not have AC." }

    // Get AC rate from package config
    const { data: config } = await admin
      .from("hms_package_configs")
      .select("ac_per_unit_rate")
      .eq("hostel_id", hostelId)
      .maybeSingle()

    const perUnitRate = Number(config?.ac_per_unit_rate ?? 0)
    if (perUnitRate <= 0) {
      return { error: "AC per-unit rate is not configured. Ask the owner to set it in Settings → Packages." }
    }

    // Find active AC-package tenants in this room
    const { data: allTenants } = await admin
      .from("hms_tenants")
      .select("id")
      .eq("hostel_id", hostelId)
      .eq("room_id", roomId)
      .eq("is_active", true)
      .eq("package_tier", "space_food_ac")

    const eligible = allTenants ?? []
    if (eligible.length === 0) {
      return { error: "No tenants with AC package in this room." }
    }

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
    const totalCharge = Math.round(units * perUnitRate)
    const baseUnits  = n > 1 ? Math.floor(units / n)       : units
    const lastUnits  = units - baseUnits * (n - 1)
    const baseCharge = n > 1 ? Math.floor(totalCharge / n) : totalCharge
    const lastCharge = totalCharge - baseCharge * (n - 1)

    const billing = eligible.map((t, idx) => ({
      id: t.id,
      tenantUnits: idx === n - 1 ? lastUnits  : baseUnits,
      charge:      idx === n - 1 ? lastCharge : baseCharge,
    }))

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
    }
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : "An unexpected error occurred." }
  }
}

export async function saveACJoinReadingAsManager(
  roomId: string,
  forMonth: string,
  tenantId: string,
  unitsAtJoin: number,
): Promise<{ error: string | null }> {
  try {
    const ctx = await requireManagerPermission("collect_payments")
    const hostelId = ctx.activeHostel.id
    const admin = createAdminClient()

    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(forMonth)) return { error: "Invalid month." }
    const units = Number(unitsAtJoin)
    if (!Number.isFinite(units) || units < 0 || units > 99_999) return { error: "Units must be 0–99,999." }

    const { data: room } = await admin
      .from("hms_rooms")
      .select("id")
      .eq("id", roomId)
      .eq("hostel_id", hostelId)
      .single()
    if (!room) return { error: "Room not found." }

    const { data: tenant } = await admin
      .from("hms_tenants")
      .select("id")
      .eq("id", tenantId)
      .eq("hostel_id", hostelId)
      .eq("room_id", roomId)
      .single()
    if (!tenant) return { error: "Tenant not found in this room." }

    const { error } = await admin
      .from("hms_room_ac_join_readings")
      .upsert(
        {
          hostel_id: hostelId,
          room_id: roomId,
          for_month: forMonth,
          tenant_id: tenantId,
          units_at_join: units,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "room_id,for_month,tenant_id" }
      )
    if (error) return { error: error.message }

    revalidatePath("/portal/payments")
    return { error: null }
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : "An unexpected error occurred." }
  }
}

export async function addTenantAsManager(formData: {
  name: string
  phone: string
  roomId: string | null
  monthlyRent: number
  checkIn: string
}): Promise<{ error: string | null }> {
  try {
    const ctx = await requireManagerPermission("add_members")
    const hostelId = ctx.activeHostel.id
    const admin = createAdminClient()

    const name = formData.name.trim()
    const phone = formData.phone.trim()
    if (!name || name.length < 2) return { error: "Full name must be at least 2 characters." }
    if (!phone) return { error: "Phone number is required." }
    if (!formData.monthlyRent || formData.monthlyRent <= 0) return { error: "Monthly rent must be greater than 0." }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(formData.checkIn)) return { error: "Invalid check-in date." }

    const insertData: Record<string, unknown> = {
      hostel_id: hostelId,
      full_name: name,
      phone,
      type: "general",
      check_in: formData.checkIn,
      billing_type: "monthly",
      package_tier: "space_only",
      monthly_rent: formData.monthlyRent,
      daily_rate: 0,
      security_deposit: 0,
      is_active: true,
      is_waiting: false,
      documents: [],
    }

    if (formData.roomId) {
      const { data: room } = await admin
        .from("hms_rooms")
        .select("id, capacity, occupied, status")
        .eq("id", formData.roomId)
        .eq("hostel_id", hostelId)
        .single()

      if (!room) return { error: "Invalid room selection." }
      if (room.status === "maintenance") return { error: "Selected room is under maintenance." }
      if (room.occupied >= room.capacity) return { error: "Selected room is at full capacity." }

      insertData.room_id = formData.roomId

      const { error: insErr } = await admin.from("hms_tenants").insert(insertData)
      if (insErr) return { error: insErr.message }

      await admin
        .from("hms_rooms")
        .update({
          occupied: room.occupied + 1,
          status: room.occupied + 1 >= room.capacity ? "occupied" : "available",
        })
        .eq("id", formData.roomId)
        .eq("hostel_id", hostelId)
    } else {
      const { error: insErr } = await admin.from("hms_tenants").insert(insertData)
      if (insErr) return { error: insErr.message }
    }

    revalidatePath("/portal/tenants")
    return { error: null }
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : "An unexpected error occurred." }
  }
}

export async function recordPaymentAsManager(
  tenantId: string,
  amount: number,
  method: string,
  month: string,
  acUnitsConsumed?: number,
): Promise<{ error: string | null }> {
  try {
    const ctx = await requireManagerPermission("collect_payments")
    const hostelId = ctx.activeHostel.id
    const admin = createAdminClient()

    const VALID_METHODS = new Set(["cash", "bank_transfer", "jazzcash", "easypaisa", "other"])
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

    const updatePayload: Record<string, unknown> = {
      status: "paid",
      amount,
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
      updatePayload.ac_units_consumed = acUnitsConsumed
      updatePayload.ac_charge = acUnitsConsumed * acUnitRate
    }

    const { error } = await admin
      .from("hms_payments")
      .update(updatePayload)
      .eq("tenant_id", tenantId)
      .eq("for_month", month)
      .eq("hostel_id", hostelId)
      .in("status", ["pending", "overdue"])

    if (error) return { error: error.message }

    revalidatePath("/portal/payments")
    return { error: null }
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : "An unexpected error occurred." }
  }
}

export async function addExpenseAsManager(
  category: string,
  amount: number,
  description: string,
  date: string,
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
      notes: null,
    })

    if (error) return { error: error.message }

    revalidatePath("/portal/expenses")
    return { error: null }
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : "An unexpected error occurred." }
  }
}
