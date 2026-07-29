import "server-only"
import { cache } from "react"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import type { Manager, ManagerContext, StaffPermission } from "@/types"

export const getManagerContext = cache(async (): Promise<ManagerContext | null> => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const admin = createAdminClient()

  const { data: mgr } = await admin
    .from("hms_managers")
    .select("*")
    .eq("supabase_user_id", user.id)
    .maybeSingle()

  if (!mgr) return null

  const [{ data: permRows }, { data: hostelRows }] = await Promise.all([
    admin.from("hms_manager_permissions").select("permission").eq("manager_id", mgr.id),
    admin
      .from("hms_manager_hostels")
      .select("hostel_id, hms_hostels(id, name)")
      .eq("manager_id", mgr.id),
  ])

  const permissions = new Set<StaffPermission>(
    (permRows ?? []).map((r: { permission: string }) => r.permission as StaffPermission)
  )

  type HostelJoinRow = { hostel_id: string; hms_hostels: { id: string; name: string } | null }
  const hostels = ((hostelRows ?? []) as unknown as HostelJoinRow[])
    .map((r) => r.hms_hostels)
    .filter((h): h is { id: string; name: string } => h !== null)

  const cookieStore = await cookies()
  const activeCookieVal = cookieStore.get("hms_active_hostel")?.value ?? null

  let activeHostel: { id: string; name: string } | null = null
  if (activeCookieVal) {
    activeHostel = hostels.find((h) => h.id === activeCookieVal) ?? null
  }
  if (!activeHostel && hostels.length > 0) {
    activeHostel = hostels[0]
  }

  const manager: Manager = {
    ...mgr,
    permissions: Array.from(permissions),
    hostels,
  }

  return { manager, permissions, hostels, activeHostel }
})

type BoundContext = ManagerContext & { activeHostel: { id: string; name: string } }

export async function requireManagerPermission(
  permission: StaffPermission,
): Promise<BoundContext> {
  const ctx = await getManagerContext()
  if (!ctx) redirect("/login")
  if (!ctx.permissions.has(permission)) redirect("/portal/access-denied")
  if (!ctx.activeHostel) redirect("/portal/access-denied")
  return ctx as BoundContext
}

// A route can be reached by a manager holding EITHER the add or the edit
// variant of a capability (e.g. a manager with only edit_members should still
// reach /portal/tenants, not just one who also has add_members).
export async function requireManagerPermissionAny(
  permissions: StaffPermission[],
): Promise<BoundContext> {
  const ctx = await getManagerContext()
  if (!ctx) redirect("/login")
  if (!permissions.some((p) => ctx.permissions.has(p))) redirect("/portal/access-denied")
  if (!ctx.activeHostel) redirect("/portal/access-denied")
  return ctx as BoundContext
}

export async function requireManagerAuth(): Promise<BoundContext> {
  const ctx = await getManagerContext()
  if (!ctx) redirect("/login")
  if (!ctx.activeHostel) redirect("/portal/access-denied")
  return ctx as BoundContext
}

export { requireManagerAuth as requireManager }
