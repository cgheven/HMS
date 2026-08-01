import { requireManagerPermission } from "@/lib/manager-auth"
import { getManagerPaymentsPageData } from "@/lib/portal-data"
import { syncMonthAction } from "@/app/actions/payments"
import { countBillableNights } from "@/lib/daily-billing"
import { expectedChargesFor } from "@/lib/monthly-payment-sync"
import { splitPaymentCharges } from "@/lib/payment-calc"
import { PaymentsClient } from "@/components/modules/payments/payments-client"
import { pktYearMonth } from "@/lib/pkt-time"

export default async function PortalPaymentsPage() {
  // Pakistan-anchored, not the server process's own OS timezone — see
  // app/(dashboard)/payments/page.tsx for why.
  const { year, month } = pktYearMonth()
  const defaultMonth = `${year}-${String(month).padStart(2, "0")}`

  const [ctx, data] = await Promise.all([
    requireManagerPermission("collect_payments"),
    getManagerPaymentsPageData(defaultMonth),
  ])

  // Same one-shot server-side sync as the owner page: if any active tenant has
  // no payment row for this month, generate the missing pending rows now.
  // Idempotent — paid/waived rows are never touched. Not a useEffect auto-sync.
  // syncMonthAction resolves a manager's branch server-side via
  // getManagerContext() and re-checks collect_payments.
  const tenantIdsWithPayments = new Set(data.payments.map((p) => p.tenant_id))
  const hasMissingRows = data.tenants.some((t) => !tenantIdsWithPayments.has(t.id))

  // Daily tenants also need re-syncing when their stored day count no longer
  // matches their dates — "missing row" never fires for a tenant who already
  // has one, so a pending daily row would otherwise keep a stale amount
  // forever. See the owner page for the full reasoning.
  const paymentByTenant = new Map(data.payments.map((p) => [p.tenant_id, p]))
  const hasStaleDailyRow = data.tenants.some((t) => {
    if (t.billing_type !== "daily") return false
    const row = paymentByTenant.get(t.id)
    if (!row || row.status !== "pending") return false
    const nights = countBillableNights({
      checkIn: t.check_in.slice(0, 10),
      checkOut: t.check_out ? t.check_out.slice(0, 10) : null,
      month: defaultMonth,
    })
    return row.billed_days !== nights
  })

  // Monthly rows go stale the same way — a rent or plan edit writes to
  // hms_tenants, which nothing on hms_payments reacts to. See the owner page.
  const roomAcMap = new Map(data.rooms.map((r) => [r.id, !!r.has_ac]))
  const hasStaleMonthlyRow = data.tenants.some((t) => {
    if (t.billing_type === "daily") return false
    const row = paymentByTenant.get(t.id)
    if (!row || row.status !== "pending") return false
    const want = expectedChargesFor(t, defaultMonth, { config: data.packageConfig, roomAcMap })
    const differs = (a: number, b: number) => Math.abs(a - b) > 0.01
    return (
      differs(splitPaymentCharges(row).rent, want.baseRent) ||
      differs(Number(row.food_charge ?? 0), want.foodCharge) ||
      differs(Number(row.security_deposit_charge ?? 0), want.depositCharge) ||
      differs(Number(row.registration_fee_charge ?? 0), want.registrationFeeCharge) ||
      differs(Number(row.ac_maintenance_charge ?? 0), want.acMaintenanceCharge) ||
      (row.payment_package_tier ?? "space_only") !== want.tier
    )
  })

  if (hasMissingRows || hasStaleDailyRow || hasStaleMonthlyRow) {
    await syncMonthAction(defaultMonth)
    const synced = await getManagerPaymentsPageData(defaultMonth)
    return (
      <PaymentsClient
        key={synced.hostelId ?? ""}
        {...synced}
        initialMonth={defaultMonth}
        managerPermissions={Array.from(ctx.permissions)}
      />
    )
  }

  return (
    <PaymentsClient
      key={data.hostelId ?? ""}
      {...data}
      initialMonth={defaultMonth}
      managerPermissions={Array.from(ctx.permissions)}
    />
  )
}
