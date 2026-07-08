import { cache } from "react"
import { createAdminClient } from "@/lib/supabase/admin"
import { getAuthContext } from "@/lib/data"
import type { Manager } from "@/types"

export const getManagersPageData = cache(async () => {
  const ctx = await getAuthContext()
  if (!ctx?.hostelId || !ctx?.user) return { managers: [], availableHostels: [], hostelId: null }

  const admin = createAdminClient()
  const [{ data: managers }, { data: hostels }] = await Promise.all([
    admin
      .from("hms_managers")
      .select("*, permissions:hms_manager_permissions(permission), hostels:hms_manager_hostels(hostel_id, hostel:hms_hostels(id, name))")
      .eq("owner_id", ctx.user.id)
      .order("created_at", { ascending: false }),
    admin
      .from("hms_hostels")
      .select("id, name")
      .eq("owner_id", ctx.user.id)
      .order("created_at"),
  ])

  const normalized = (managers ?? []).map((m) => ({
    ...m,
    permissions: (m.permissions ?? []).map((p: { permission: string }) => p.permission),
    hostels: (m.hostels ?? []).map((h: { hostel: { id: string; name: string } }) => h.hostel).filter(Boolean),
  })) as Manager[]

  return {
    managers: normalized,
    availableHostels: (hostels ?? []) as { id: string; name: string }[],
    hostelId: ctx.hostelId,
  }
})
