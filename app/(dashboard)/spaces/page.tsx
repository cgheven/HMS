import { getRooms, getAuthContext } from "@/lib/data";
import { SpacesClient } from "@/components/modules/spaces/spaces-client";

export default async function SpacesPage() {
  const [{ hostelId, rooms }, ctx] = await Promise.all([getRooms(), getAuthContext()]);
  return <SpacesClient key={hostelId ?? ''} hostelId={hostelId} initialRooms={rooms} partnerTier={ctx?.partnerTier} />;
}
