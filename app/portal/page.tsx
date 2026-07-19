import { redirect } from "next/navigation"
import { getManagerContext } from "@/lib/manager-auth"

export default async function PortalRootPage() {
  const ctx = await getManagerContext()

  // Only an unauthenticated caller goes back to /login. A signed-in manager who
  // simply has no branch assigned must NOT be sent there: middleware bounces an
  // authenticated user off /login to /, app/page.tsx sends a manager to /portal,
  // and we land right back here — an infinite redirect loop that renders as the
  // portal endlessly reloading with an empty shell.
  if (!ctx) redirect("/login")
  if (!ctx.activeHostel) redirect("/portal/access-denied")

  if (ctx.permissions.has("add_members")) redirect("/portal/tenants")
  if (ctx.permissions.has("collect_payments")) redirect("/portal/payments")
  if (ctx.permissions.has("add_expenses")) redirect("/portal/expenses")

  redirect("/portal/access-denied")
}
