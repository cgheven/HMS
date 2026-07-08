import { redirect } from "next/navigation"
import { getManagerContext } from "@/lib/manager-auth"
import { PortalShell } from "@/components/layout/portal-shell"

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getManagerContext()
  if (!ctx) redirect("/login")

  return (
    <PortalShell
      manager={ctx.manager}
      permissions={Array.from(ctx.permissions)}
      hostels={ctx.hostels}
      activeHostel={ctx.activeHostel}
    >
      {children}
    </PortalShell>
  )
}
