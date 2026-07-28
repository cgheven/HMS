-- Ms National Boys hostel: the 66 pending July payment rows were generated
-- (by the payment-reminders cron, via ensureMonthlyPaymentRows) BEFORE
-- migration 131 corrected each tenant's package_tier from 'space_only' to
-- 'space_3meals'. hms_payments snapshots the tier into its own
-- payment_package_tier column at row-creation/refresh time (see
-- lib/monthly-payment-sync.ts) rather than reading hms_tenants live, so the
-- Payments > Monthly View "Plan" column kept showing the stale "Space Only"
-- even after the tenant record itself was fixed.
--
-- Scoped to status = 'pending' only (matches ensureMonthlyPaymentRows'
-- own rule of never touching paid/waived rows) — safe no-op for any tenant
-- for whom this doesn't apply. This hostel's food_monthly_rate is 0, so
-- food_charge/amount are unaffected either way; only the tier label is fixed.

DO $$
DECLARE
  h uuid := '514a77a0-167d-48e7-a47d-6b526a766937'; -- Ms National Boys hostel
  updated_count int;
BEGIN
  UPDATE hms_payments
  SET payment_package_tier = 'space_3meals'
  WHERE hostel_id = h
    AND for_month = '2026-07'
    AND status = 'pending'
    AND payment_package_tier = 'space_only';

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  IF updated_count <> 66 THEN
    RAISE EXCEPTION 'Expected to update 66 payment rows, updated %', updated_count;
  END IF;
END $$;
