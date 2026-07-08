import { requireManagerPermission } from "@/lib/manager-auth"
import { PortalAddExpense } from "@/components/modules/managers/portal-add-expense"

export default async function PortalExpensesPage() {
  const ctx = await requireManagerPermission("add_expenses")

  return (
    <PortalAddExpense key={ctx.activeHostel.id} hostelId={ctx.activeHostel.id} />
  )
}
