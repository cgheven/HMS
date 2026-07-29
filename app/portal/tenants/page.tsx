import { requireManagerPermissionAny } from "@/lib/manager-auth"
import { getManagerTenants } from "@/lib/portal-data"
import { TenantsClient } from "@/components/modules/tenants/tenants-client"

export default async function PortalTenantsPage() {
  const [ctx, data] = await Promise.all([
    requireManagerPermissionAny(["add_members", "edit_members"]),
    getManagerTenants(),
  ])

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
    />
  )
}
