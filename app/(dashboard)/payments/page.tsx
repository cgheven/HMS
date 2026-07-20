import { getPaymentsPageData, getAuthContext } from "@/lib/data";
import { syncMonthAction } from "@/app/actions/payments";
import { countBillableNights } from "@/lib/daily-billing";
import { PaymentsClient } from "@/components/modules/payments/payments-client";

export default async function PaymentsPage() {
  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const [data, ctx] = await Promise.all([getPaymentsPageData(defaultMonth), getAuthContext()]);

  // If any active tenant is missing a payment row for this month, generate them
  // server-side now. Handles new months, new tenants added mid-month, and hostels
  // that have never triggered a sync from the client. Idempotent — paid/waived
  // rows are never touched; pending rows are refreshed against current rates.
  // This is NOT a useEffect auto-sync; it runs once per server render.
  // Runs for partners too, not just owners — syncMonthAction writes via the
  // admin client now (no partner write RLS grant exists on hms_payments), so
  // it's safe for any tier. It has to run regardless of who loads the page
  // first: a partner landing here before the owner ever has for this
  // branch/month previously saw a permanently empty page.
  const tenantIdsWithPayments = new Set(data.payments.map((p) => p.tenant_id));
  const hasMissingRows = data.tenants.some((t) => !tenantIdsWithPayments.has(t.id));

  // Daily tenants need a second trigger. "Missing row" alone never fires for a
  // tenant who already has one, so a pending daily row kept its original day
  // count forever — even after the check-out date changed. Monthly rows don't
  // have this problem: the migration-082 trigger re-derives their amount from
  // monthly_rent on any write, so they self-heal. For daily rows that trigger
  // deliberately preserves the app-supplied amount, which makes syncMonthAction
  // the only thing that can correct them — and it was never being called.
  // Restricted to 'pending' because that is exactly the set syncMonthAction
  // refreshes; widening it here would re-render on every load without fixing
  // anything.
  const paymentByTenant = new Map(data.payments.map((p) => [p.tenant_id, p]));
  const hasStaleDailyRow = data.tenants.some((t) => {
    if (t.billing_type !== "daily") return false;
    const row = paymentByTenant.get(t.id);
    if (!row || row.status !== "pending") return false;
    const nights = countBillableNights({
      checkIn: t.check_in.slice(0, 10),
      checkOut: t.check_out ? t.check_out.slice(0, 10) : null,
      month: defaultMonth,
    });
    return row.billed_days !== nights;
  });

  if (hasMissingRows || hasStaleDailyRow) {
    await syncMonthAction(defaultMonth);
    const synced = await getPaymentsPageData(defaultMonth);
    return <PaymentsClient key={synced.hostelId ?? ''} {...synced} initialMonth={defaultMonth} partnerTier={ctx?.partnerTier} />;
  }

  return <PaymentsClient key={data.hostelId ?? ''} {...data} initialMonth={defaultMonth} partnerTier={ctx?.partnerTier} />;
}
