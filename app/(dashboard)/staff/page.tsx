import { getEmployeesData, getAuthContext } from "@/lib/data";
import { StaffClient } from "@/components/modules/staff/staff-client";

export default async function StaffPage() {
  const [data, ctx] = await Promise.all([getEmployeesData(), getAuthContext()]);
  return <StaffClient key={data.hostelId ?? ''} {...data} partnerTier={ctx?.partnerTier} />;
}
