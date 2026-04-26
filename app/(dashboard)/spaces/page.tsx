import { getRooms } from "@/lib/data";
import { SpacesClient } from "@/components/modules/spaces/spaces-client";

export default async function SpacesPage() {
  const { hostelId, rooms } = await getRooms();
  return <SpacesClient hostelId={hostelId} initialRooms={rooms} />;
}
