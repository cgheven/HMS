import { getAuthContext } from "@/lib/data";
import { getReportData } from "@/app/actions/reports";
import { ReportsClient } from "@/components/modules/reports/reports-client";
import { redirect } from "next/navigation";
import { yearMonthInZone } from "@/lib/pkt-time";
import { getCountryConfig } from "@/lib/country-config";

export default async function ReportsPage() {
  const ctx = await getAuthContext();
  if (!ctx?.user) redirect("/login");
  if (!ctx.hostelId) {
    // Pass null to trigger empty state
    return <ReportsClient hostelId="" initialData={null} initialFrom="" initialTo="" />;
  }

  // Active hostel's own calendar month (its timezone), not the server's OS
  // timezone nor a fixed PKT — a UK branch rolls over at London time.
  const { year, month } = yearMonthInZone(getCountryConfig(ctx.hostel?.country).timezone);
  const to = `${year}-${String(month).padStart(2, "0")}`;
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
