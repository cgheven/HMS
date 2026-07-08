import { requireManagerPermission } from "@/lib/manager-auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { PortalAddMember } from "@/components/modules/managers/portal-add-member"

export default async function PortalTenantsPage() {
  const ctx = await requireManagerPermission("add_members")
  const hostelId = ctx.activeHostel.id

  const admin = createAdminClient()
  const { data: rooms } = await admin
    .from("hms_rooms")
    .select("id, room_number, capacity, occupied")
    .eq("hostel_id", hostelId)
    .neq("status", "maintenance")
    .order("room_number")

  return (
    <PortalAddMember
      key={hostelId}
      hostelId={hostelId}
      rooms={(rooms ?? []) as { id: string; room_number: string; capacity: number; occupied: number }[]}
    />
  )
}
