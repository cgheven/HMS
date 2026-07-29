import { requireManagerPermissionAny } from "@/lib/manager-auth"
import { getManagerKitchenExpenses } from "@/lib/portal-data"
import { KitchenClient } from "@/components/modules/kitchen/kitchen-client"

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

export default async function PortalKitchenPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`

  // In manager mode KitchenClient switches months by pushing ?month=YYYY-MM and
  // calling router.refresh() — it cannot re-query itself, since managers have no
  // RLS grant. Validate before it reaches the data layer.
  const params = await searchParams
  const defaultMonth = params.month && MONTH_RE.test(params.month) ? params.month : currentMonth

  const [ctx, { hostelId, items }] = await Promise.all([
    requireManagerPermissionAny(["add_kitchen_expenses", "edit_kitchen_expenses"]),
    getManagerKitchenExpenses(defaultMonth),
  ])

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
