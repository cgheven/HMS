import { getComplaints } from "@/lib/data";
import { ComplaintsClient } from "@/components/modules/complaints/complaints-client";

export default async function ComplaintsPage() {
  const data = await getComplaints();
  return <ComplaintsClient {...data} />;
}
