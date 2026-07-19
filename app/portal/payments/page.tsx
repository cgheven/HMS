import { requireManagerPermission } from "@/lib/manager-auth"
import { getManagerPaymentsPageData } from "@/lib/portal-data"
import { syncMonthAction } from "@/app/actions/payments"
import { PaymentsClient } from "@/components/modules/payments/payments-client"

export default async function PortalPaymentsPage() {
  const now = new Date()
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`

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

  if (hasMissingRows) {
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
