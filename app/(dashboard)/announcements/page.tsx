import { getAnnouncements, getAuthContext } from "@/lib/data";
import { AnnouncementsClient } from "@/components/modules/announcements/announcements-client";

export default async function AnnouncementsPage() {
  const [data, ctx] = await Promise.all([getAnnouncements(), getAuthContext()]);
  return <AnnouncementsClient key={data.hostelId ?? ''} {...data} partnerTier={ctx?.partnerTier} />;
}
