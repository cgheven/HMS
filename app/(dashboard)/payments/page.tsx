import { getPaymentsPageData, getAuthContext } from "@/lib/data";
import { syncMonthAction } from "@/app/actions/payments";
import { countBillableNights } from "@/lib/daily-billing";
import { expectedChargesFor } from "@/lib/monthly-payment-sync";
import { splitPaymentCharges } from "@/lib/payment-calc";
import { PaymentsClient } from "@/components/modules/payments/payments-client";
import { pktYearMonth } from "@/lib/pkt-time";
import { settleReferralRewards } from "@/lib/referral-rewards";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function PaymentsPage() {
  // Pakistan-anchored, not the server process's own OS timezone — Vercel's
  // serverless functions default to UTC, a developer's own machine is
  // whatever it's set to, and "this month" must agree between them.
  const { year, month } = pktYearMonth();
  const defaultMonth = `${year}-${String(month).padStart(2, "0")}`;

  const [data, ctx] = await Promise.all([getPaymentsPageData(defaultMonth), getAuthContext()]);

  // Referral rewards reconcile on EVERY load, unconditionally — not inside
  // ensureMonthlyPaymentRows below, which only does work when a row is already
  // stale. A reward granted after its bill was written leaves the bill at full
  // price until something re-prices it, and staleness never notices because no
  // charge the sync knows about has changed. One indexed probe; returns 0 for
  // every branch that has not enabled referrals.
  await settleReferralRewards(createAdminClient(), data.hostelId, defaultMonth);

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

  // "Missing row" alone never fires for a tenant who already has one, so an
  // existing pending row has to be checked against the tenant's current rates
  // directly. Restricted to 'pending' because that is exactly the set
  // syncMonthAction refreshes; widening it would re-render on every load
  // without fixing anything.
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

  // Monthly rows were assumed to self-heal, on the grounds that the payment
  // trigger re-derives `amount` from monthly_rent on every write. It does — but
  // it only runs on writes to hms_payments, and editing a tenant writes to
  // hms_tenants. So changing someone's rent left their pending row on the old
  // figure until something unrelated happened to touch it (a new tenant forcing
  // a sync, or the reminders cron), which is why the Payments page appeared to
  // update "eventually" instead of on the next load.
  //
  // Compared component by component rather than against `amount`, because the
  // trigger folds ac_charge back into the stored total and metered AC is
  // deliberately preserved across a sync — a total-vs-total check would flag
  // every AC row as stale forever.
  const roomAcMap = new Map(data.rooms.map((r) => [r.id, !!r.has_ac]));
  const hasStaleMonthlyRow = data.tenants.some((t) => {
    if (t.billing_type === "daily") return false;
    const row = paymentByTenant.get(t.id);
    if (!row || row.status !== "pending") return false;
    const want = expectedChargesFor(t, defaultMonth, { config: data.packageConfig, roomAcMap });
    const differs = (a: number, b: number) => Math.abs(a - b) > 0.01;
    return (
      differs(splitPaymentCharges(row).rent, want.baseRent) ||
      differs(Number(row.food_charge ?? 0), want.foodCharge) ||
      differs(Number(row.security_deposit_charge ?? 0), want.depositCharge) ||
      differs(Number(row.registration_fee_charge ?? 0), want.registrationFeeCharge) ||
      differs(Number(row.ac_maintenance_charge ?? 0), want.acMaintenanceCharge) ||
      (row.payment_package_tier ?? "space_only") !== want.tier
    );
  });

  if (hasMissingRows || hasStaleDailyRow || hasStaleMonthlyRow) {
    await syncMonthAction(defaultMonth);
    const synced = await getPaymentsPageData(defaultMonth);
    return <PaymentsClient key={synced.hostelId ?? ''} {...synced} initialMonth={defaultMonth} partnerTier={ctx?.partnerTier} />;
  }

  return <PaymentsClient key={data.hostelId ?? ''} {...data} initialMonth={defaultMonth} partnerTier={ctx?.partnerTier} />;
}
