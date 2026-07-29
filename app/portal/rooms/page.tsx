import { requireManagerPermission } from "@/lib/manager-auth"
import { getManagerRooms } from "@/lib/portal-data"
import { SpacesClient } from "@/components/modules/spaces/spaces-client"

export default async function PortalRoomsPage() {
  const [ctx, data] = await Promise.all([
    requireManagerPermission("manage_rooms"),
    getManagerRooms(),
  ])

  return (
    <SpacesClient
      key={data.hostelId ?? ""}
      hostelId={data.hostelId}
      initialRooms={data.rooms}
      hostelName={data.hostelName}
      managerPermissions={Array.from(ctx.permissions)}
    />
  )
}
