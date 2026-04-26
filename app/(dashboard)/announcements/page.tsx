import { getAnnouncements } from "@/lib/data";
import { AnnouncementsClient } from "@/components/modules/announcements/announcements-client";

export default async function AnnouncementsPage() {
  const data = await getAnnouncements();
  return <AnnouncementsClient {...data} />;
}
