import { getPaymentsPageData } from "@/lib/data";
import { syncMonthAction } from "@/app/actions/payments";
import { PaymentsClient } from "@/components/modules/payments/payments-client";

export default async function PaymentsPage() {
  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  // First pass: check if payment rows exist for this month
  const data = await getPaymentsPageData(defaultMonth);

  // If any active tenant is missing a payment row for this month, generate them
  // server-side now. Handles new months, new tenants added mid-month, and hostels
  // that have never triggered a sync from the client. Idempotent — paid/waived
  // rows and existing pending rows are never overwritten by syncMonthAction.
  // This is NOT a useEffect auto-sync; it runs once per server render.
  const tenantIdsWithPayments = new Set(data.payments.map((p) => p.tenant_id));
  const hasMissingRows = data.tenants.some((t) => !tenantIdsWithPayments.has(t.id));

  if (hasMissingRows) {
    await syncMonthAction(defaultMonth);
    const synced = await getPaymentsPageData(defaultMonth);
    return <PaymentsClient key={synced.hostelId ?? ''} {...synced} initialMonth={defaultMonth} />;
  }

  return <PaymentsClient key={data.hostelId ?? ''} {...data} initialMonth={defaultMonth} />;
}
