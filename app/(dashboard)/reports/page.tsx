import { getAuthContext } from "@/lib/data";
import { getReportData } from "@/app/actions/reports";
import { ReportsClient } from "@/components/modules/reports/reports-client";
import { redirect } from "next/navigation";
import { pktYearMonth } from "@/lib/pkt-time";

export default async function ReportsPage() {
  const ctx = await getAuthContext();
  if (!ctx?.user) redirect("/login");
  if (!ctx.hostelId) {
    // Pass null to trigger empty state
    return <ReportsClient hostelId="" initialData={null} initialFrom="" initialTo="" />;
  }

  // Pakistan-anchored, not the server process's own OS timezone — Vercel's
  // serverless functions default to UTC, which can silently disagree with
  // Pakistan on what "this month" is.
  const { year, month } = pktYearMonth();
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
