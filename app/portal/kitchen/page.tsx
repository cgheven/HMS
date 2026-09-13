import { requireManagerPermissionAny } from "@/lib/manager-auth"
import { getManagerKitchenExpenses } from "@/lib/portal-data"
import { KitchenClient } from "@/components/modules/kitchen/kitchen-client"
import { yearMonthInZone } from "@/lib/pkt-time"
import { getCountryConfig } from "@/lib/country-config"

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

export default async function PortalKitchenPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  // The manager's hostel's own calendar month (its timezone) — see
  // app/(dashboard)/payments/page.tsx for why.
  const ctx = await requireManagerPermissionAny(["add_kitchen_expenses", "edit_kitchen_expenses"])
  const { year, month } = yearMonthInZone(getCountryConfig(ctx.activeHostel?.country).timezone)
  const currentMonth = `${year}-${String(month).padStart(2, "0")}`

  // In manager mode KitchenClient switches months by pushing ?month=YYYY-MM and
  // calling router.refresh() — it cannot re-query itself, since managers have no
  // RLS grant. Validate before it reaches the data layer.
  const params = await searchParams
  const defaultMonth = params.month && MONTH_RE.test(params.month) ? params.month : currentMonth

  const { hostelId, items } = await getManagerKitchenExpenses(defaultMonth)

  return (
    <KitchenClient
      key={hostelId ?? ""}
      hostelId={hostelId}
      initialItems={items}
      defaultMonth={defaultMonth}
      managerPermissions={Array.from(ctx.permissions)}
    />
  )
}
