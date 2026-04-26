import { getReportsData } from "@/lib/data";
import { ReportsClient } from "@/components/modules/reports/reports-client";

export default async function ReportsPage() {
  const data = await getReportsData();
  return <ReportsClient data={data} />;
}
