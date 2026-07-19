import { requireManagerPermission } from "@/lib/manager-auth"
import { getManagerExpenses } from "@/lib/portal-data"
import { ExpensesClient } from "@/components/modules/expenses/expenses-client"

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

export default async function PortalExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`

  // In manager mode ExpensesClient switches months by pushing ?month=YYYY-MM and
  // calling router.refresh() — it cannot re-query itself, since managers have no
  // RLS grant. Validate before it reaches the data layer.
  const params = await searchParams
  const defaultMonth = params.month && MONTH_RE.test(params.month) ? params.month : currentMonth

  const [ctx, { hostelId, expenses }] = await Promise.all([
    requireManagerPermission("add_expenses"),
    getManagerExpenses(defaultMonth),
  ])

  return (
    <ExpensesClient
      key={hostelId ?? ""}
      hostelId={hostelId}
      initialExpenses={expenses}
      defaultMonth={defaultMonth}
      managerPermissions={Array.from(ctx.permissions)}
    />
  )
}
