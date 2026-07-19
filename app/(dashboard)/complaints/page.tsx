import { getComplaints, getAuthContext } from "@/lib/data";
import { ComplaintsClient } from "@/components/modules/complaints/complaints-client";

export default async function ComplaintsPage() {
  const [data, ctx] = await Promise.all([getComplaints(), getAuthContext()]);
  return <ComplaintsClient key={data.hostelId ?? ''} {...data} partnerTier={ctx?.partnerTier} />;
}
