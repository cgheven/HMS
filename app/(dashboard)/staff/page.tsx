import { getEmployeesData } from "@/lib/data";
import { StaffClient } from "@/components/modules/staff/staff-client";

export default async function StaffPage() {
  const data = await getEmployeesData();
  return <StaffClient {...data} />;
}
