-- Atomic auto-freeze for overdue BANK/manual clients, called by the daily
-- account-freeze cron. One UPDATE statement so unpaid / paddle / frozen are all
-- evaluated at write time — no TOCTOU window where a payment landing mid-run
-- gets a just-paid client re-frozen.
--
-- Two conditions must BOTH hold for a freeze:
--   1. due_date <= today (PKT)  — the billing-date+7 deadline has arrived, and
--   2. first_sent_at <= now()-7d — the client has actually HAD the invoice for a
--      full 7 days. This grace floor is the safety net for a back-dated or
--      catch-up invoice (onboarding with a past anchor, or a >7-day cron
--      outage): such an invoice is born past its due_date, so without (2) it
--      would auto-send and freeze the same morning with zero grace, and could
--      mass-freeze every lagged client at once. For a normally-timed invoice
--      first_sent_at ≈ period_start so (2) coincides with (1) — no behaviour
--      change; the floor only ever DELAYS a freeze, never advances it.
--
-- Paddle-billed owners (active/trialing/past_due/paused) are excluded — Paddle
-- runs its own card dunning. super_admin and already-frozen are excluded.
-- Unfreeze is NOT done here (payment clears it via webhook / markInvoiceStatus).

CREATE OR REPLACE FUNCTION public.hms_freeze_overdue_accounts()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.hms_profiles p
  SET frozen = true
  WHERE p.frozen = false
    AND p.role <> 'super_admin'
    AND EXISTS (
      SELECT 1 FROM public.hms_platform_invoices i
      WHERE i.owner_id = p.id
        AND i.status = 'unpaid'
        AND i.first_sent_at IS NOT NULL
        AND i.first_sent_at <= now() - interval '7 days'
        AND i.due_date <= (now() AT TIME ZONE 'Asia/Karachi')::date
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.hms_paddle_subscriptions s
      WHERE s.owner_id = p.id
        AND s.status IN ('active','trialing','past_due','paused')
    )
  RETURNING p.id;
$$;

-- Service-role only (the cron authenticates with the service key). REVOKE FROM
-- PUBLIC alone is NOT enough on Supabase: default privileges grant EXECUTE to
-- anon + authenticated on every new public function, and those are role-specific
-- grants that a FROM PUBLIC revoke does not touch — so revoke them explicitly.
-- (An anon caller has auth.uid() = NULL, which the hms_guard_frozen trigger lets
-- through, so leaving anon with EXECUTE would let anyone trigger the freeze job.)
REVOKE ALL ON FUNCTION public.hms_freeze_overdue_accounts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hms_freeze_overdue_accounts() TO service_role;
