import { redirect } from "next/navigation"
import { getManagerContext } from "@/lib/manager-auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { PortalShell } from "@/components/layout/portal-shell"
import { AccountSuspendedNotice } from "@/components/layout/account-suspended-notice"

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getManagerContext()
  if (!ctx) redirect("/login")

  // A manager can't pay the owner's SaaS bill (billing is owner-only). When the
  // account owner is frozen for unpaid dues — which blocks the manager's own
  // writes account-wide (migration 231 + manager-auth) — show the read-only
  // notice naming the owner instead of leaving them to hit bare "suspended" errors.
  const admin = createAdminClient()
  const { data: ownerRow } = await admin
    .from("hms_profiles").select("frozen, full_name").eq("id", ctx.manager.owner_id).maybeSingle()
  const owner = ownerRow as { frozen?: boolean; full_name?: string | null } | null

  return (
    <PortalShell
      manager={ctx.manager}
      permissions={Array.from(ctx.permissions)}
      hostels={ctx.hostels}
      activeHostel={ctx.activeHostel}
    >
      {owner?.frozen ? <AccountSuspendedNotice ownerName={owner.full_name ?? null} /> : null}
      {children}
    </PortalShell>
  )
}
