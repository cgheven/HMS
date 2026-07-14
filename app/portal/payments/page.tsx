import { requireManagerPermission } from "@/lib/manager-auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { PortalPayments } from "@/components/modules/managers/portal-payments"

export default async function PortalPaymentsPage() {
  const ctx = await requireManagerPermission("collect_payments")
  const hostelId = ctx.activeHostel.id

  const now = new Date()
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`

  const [y, m] = month.split("-").map(Number)
  const prevDate = new Date(y, m - 2, 1)
  const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}`

  const admin = createAdminClient()

  type RawPayment = {
    id: string
    tenant_id: string
    for_month: string
    amount: number
    amount_paid: number | null
    late_fee: number
    status: string
    ac_units_consumed: number | null
    ac_charge: number | null
    tenant: { full_name: string; room_id: string | null; package_tier: string | null } | null
  }
  type RoomRow     = { id: string; room_number: string; has_ac: boolean | null }
  type ACReading   = { room_id: string; total_units: number; meter_reading?: number | null; per_unit_rate: number; tenant_count: number }
  type ACTenant    = { id: string; full_name: string; room_id: string | null; package_tier: string | null; check_in: string }
  type ACJoinRead  = { room_id: string; tenant_id: string; units_at_join: number; for_month: string }
  type PrevACRead  = { room_id: string; meter_reading: number | null }

  const [
    { data: rawPayments },
    { data: rooms },
    { data: acConfig },
    { data: acReadings },
    { data: acTenants },
    { data: acJoinReadings },
    { data: prevMonthACReadings },
  ] = await Promise.all([
    admin
      .from("hms_payments")
      .select("id, tenant_id, for_month, amount, amount_paid, late_fee, status, ac_units_consumed, ac_charge, tenant:hms_tenants(full_name, room_id, package_tier)")
      .eq("hostel_id", hostelId)
      .eq("for_month", month)
      .in("status", ["pending", "overdue", "partially_paid"])
      .order("created_at", { ascending: false }) as unknown as Promise<{ data: RawPayment[] | null }>,

    admin
      .from("hms_rooms")
      .select("id, room_number, has_ac")
      .eq("hostel_id", hostelId) as unknown as Promise<{ data: RoomRow[] | null }>,

    admin
      .from("hms_package_configs")
      .select("ac_per_unit_rate")
      .eq("hostel_id", hostelId)
      .maybeSingle() as unknown as Promise<{ data: { ac_per_unit_rate: number } | null }>,

    admin
      .from("hms_room_ac_readings")
      .select("room_id, total_units, meter_reading, per_unit_rate, tenant_count")
      .eq("hostel_id", hostelId)
      .eq("for_month", month) as unknown as Promise<{ data: ACReading[] | null }>,

    // All active tenants — every occupant of an AC room shares the bill
    admin
      .from("hms_tenants")
      .select("id, full_name, room_id, package_tier, check_in")
      .eq("hostel_id", hostelId)
      .eq("is_active", true) as unknown as Promise<{ data: ACTenant[] | null }>,

    admin
      .from("hms_room_ac_join_readings")
      .select("room_id, tenant_id, units_at_join, for_month")
      .eq("hostel_id", hostelId) as unknown as Promise<{ data: ACJoinRead[] | null }>,

    admin
      .from("hms_room_ac_readings")
      .select("room_id, meter_reading")
      .eq("hostel_id", hostelId)
      .eq("for_month", prevMonth) as unknown as Promise<{ data: PrevACRead[] | null }>,
  ])

  const roomMap = Object.fromEntries((rooms ?? []).map((r) => [r.id, r.room_number]))

  const payments = (rawPayments ?? []).map((p) => ({
    id: p.id,
    tenant_id: p.tenant_id,
    for_month: p.for_month,
    amount: Number(p.amount),
    amountPaid: Number(p.amount_paid ?? 0),
    late_fee: Number(p.late_fee ?? 0),
    status: p.status as "pending" | "overdue" | "partially_paid",
    tenantName: p.tenant?.full_name ?? "Unknown",
    roomNumber: p.tenant?.room_id ? (roomMap[p.tenant.room_id] ?? null) : null,
    packageTier: p.tenant?.package_tier ?? null,
    acUnitsConsumed: Number(p.ac_units_consumed ?? 0),
    acCharge: Number(p.ac_charge ?? 0),
  }))

  const acRooms = (rooms ?? [])
    .filter((r) => r.has_ac)
    .sort((a, b) => a.room_number.localeCompare(b.room_number, undefined, { numeric: true }))
    .map((r) => ({ id: r.id, room_number: r.room_number }))

  return (
    <PortalPayments
      key={hostelId}
      payments={payments}
      hostelId={hostelId}
      month={month}
      acUnitRate={Number(acConfig?.ac_per_unit_rate ?? 0)}
      acRooms={acRooms}
      acReadings={acReadings ?? []}
      acJoinReadings={acJoinReadings ?? []}
      acTenants={acTenants ?? []}
      prevMonthACReadings={prevMonthACReadings ?? []}
    />
  )
}
