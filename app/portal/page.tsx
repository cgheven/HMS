import { redirect } from "next/navigation"
import { getManagerContext } from "@/lib/manager-auth"

export default async function PortalRootPage() {
  const ctx = await getManagerContext()

  if (!ctx || !ctx.activeHostel) {
    redirect("/login")
  }

  if (ctx.permissions.has("add_members")) redirect("/portal/tenants")
  if (ctx.permissions.has("collect_payments")) redirect("/portal/payments")
  if (ctx.permissions.has("add_expenses")) redirect("/portal/expenses")

  redirect("/portal/access-denied")
}
