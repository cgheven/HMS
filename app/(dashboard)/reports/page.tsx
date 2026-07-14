import { getAuthContext } from "@/lib/data";
import { getReportData } from "@/app/actions/reports";
import { ReportsClient } from "@/components/modules/reports/reports-client";
import { redirect } from "next/navigation";

function getMonthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export default async function ReportsPage() {
  const ctx = await getAuthContext();
  if (!ctx?.user) redirect("/login");
  if (!ctx.hostelId) {
    // Pass null to trigger empty state
    return <ReportsClient hostelId="" initialData={null} initialFrom="" initialTo="" />;
  }

  const now = new Date();
  const to = getMonthKey(now);
  const from = to;
  const label = "This Month";

  const { data } = await getReportData(ctx.hostelId, from, to, label);

  return (
    <ReportsClient
      key={ctx.hostelId}
      hostelId={ctx.hostelId}
      initialData={data}
      initialFrom={from}
      initialTo={to}
    />
  );
}
