import { requireManagerPermissionAny } from "@/lib/manager-auth"
import { getManagerTenants } from "@/lib/portal-data"
import { TenantsClient } from "@/components/modules/tenants/tenants-client"

export default async function PortalTenantsPage() {
  const [ctx, data] = await Promise.all([
    requireManagerPermissionAny(["add_members", "edit_members"]),
    getManagerTenants(),
  ])

  // The manager's OTHER managed branches, for "Move to another branch". Manager
  // permissions are global to the manager, so edit_members applies to every
  // branch they manage — offer all of them except the active one. Empty (control
  // hidden) for a single-branch manager or one without edit_members. The server
  // action re-verifies edit_members + that both branches are managed.
  const branchTargets = ctx.permissions.has("edit_members")
    ? (ctx.hostels ?? [])
        .filter((h) => h.id !== ctx.activeHostel.id)
        .map((h) => ({ id: h.id, name: h.name }))
    : []

  // Applications and the waitlist come from getManagerTenants (admin client,
  // scoped to the manager's branch). hostelSlug stays null: the public signup
  // link is an account-level surface a manager has no business resharing.
  return (
    <TenantsClient
      key={data.hostelId ?? ""}
      {...data}
      hostelSlug={null}
      hostelName={ctx.activeHostel.name}
      managerPermissions={Array.from(ctx.permissions)}
      initialPackageConfig={data.packageConfig}
      branchTargets={branchTargets}
    />
  )
}
