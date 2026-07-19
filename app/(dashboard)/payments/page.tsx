import { getPaymentsPageData, getAuthContext } from "@/lib/data";
import { syncMonthAction } from "@/app/actions/payments";
import { PaymentsClient } from "@/components/modules/payments/payments-client";

export default async function PaymentsPage() {
  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const [data, ctx] = await Promise.all([getPaymentsPageData(defaultMonth), getAuthContext()]);

  // If any active tenant is missing a payment row for this month, generate them
  // server-side now. Handles new months, new tenants added mid-month, and hostels
  // that have never triggered a sync from the client. Idempotent — paid/waived
  // rows and existing pending rows are never overwritten by syncMonthAction.
  // This is NOT a useEffect auto-sync; it runs once per server render.
  // Runs for partners too, not just owners — syncMonthAction writes via the
  // admin client now (no partner write RLS grant exists on hms_payments), so
  // it's safe for any tier. It has to run regardless of who loads the page
  // first: a partner landing here before the owner ever has for this
  // branch/month previously saw a permanently empty page.
  const tenantIdsWithPayments = new Set(data.payments.map((p) => p.tenant_id));
  const hasMissingRows = data.tenants.some((t) => !tenantIdsWithPayments.has(t.id));

  if (hasMissingRows) {
    await syncMonthAction(defaultMonth);
    const synced = await getPaymentsPageData(defaultMonth);
    return <PaymentsClient key={synced.hostelId ?? ''} {...synced} initialMonth={defaultMonth} partnerTier={ctx?.partnerTier} />;
  }

  return <PaymentsClient key={data.hostelId ?? ''} {...data} initialMonth={defaultMonth} partnerTier={ctx?.partnerTier} />;
}
