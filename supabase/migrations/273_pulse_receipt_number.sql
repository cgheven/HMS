-- Branded, collision-proof receipt numbers: PULSE-YYYYMM-NNNNN
--
-- Replaces the old HMS-YYYYMM-<initials>-<3 random digits>, which was generated
-- in the BROWSER and could collide: 900 possible values per tenant-month, with
-- no uniqueness check anywhere. A receipt number is quoted in disputes, so two
-- payments sharing one is a real problem.
--
-- The counter is platform-wide and never resets, so a number identifies exactly
-- one payment across every branch and every month, forever. The YYYYMM prefix is
-- the bill's own month (not the issue date), so a receipt still reads as
-- belonging to the period it settles.
--
-- Existing receipt numbers are NOT rewritten. A number already printed on a
-- document a resident holds must keep saying what it said.

SET lock_timeout = '3s';

CREATE SEQUENCE IF NOT EXISTS public.hms_receipt_seq AS bigint START WITH 1 INCREMENT BY 1 NO CYCLE;

CREATE OR REPLACE FUNCTION public.hms_next_receipt_number(p_month text)
RETURNS text
LANGUAGE plpgsql
-- SECURITY INVOKER (the default) on purpose: the only role granted EXECUTE is
-- service_role, which already holds USAGE on the sequence, so DEFINER would add
-- privilege without buying anything. search_path is still pinned.
SET search_path = public, pg_temp
AS $$
DECLARE
  v_month text;
  v_n     bigint;
BEGIN
  -- Accepts 'YYYY-MM' (how for_month is stored) or 'YYYYMM'. Anything else falls
  -- back to the current month rather than producing a malformed number.
  v_month := regexp_replace(coalesce(p_month, ''), '[^0-9]', '', 'g');
  IF length(v_month) <> 6 THEN
    v_month := to_char(now() AT TIME ZONE 'utc', 'YYYYMM');
  END IF;

  -- nextval is transaction-safe and never hands the same value twice, even under
  -- concurrent collection. It does not roll back, so an abandoned payment leaves
  -- a gap — correct for a receipt series, where reuse would be the actual fault.
  v_n := nextval('public.hms_receipt_seq');

  RETURN 'PULSE-' || v_month || '-' || lpad(v_n::text, 5, '0');
END;
$$;

-- Callable ONLY by the service role: every payment write already goes through
-- createAdminClient(). Leaving it on anon/authenticated would let anyone burn
-- through the series from the browser.
REVOKE ALL ON FUNCTION public.hms_next_receipt_number(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hms_next_receipt_number(text) TO service_role;

REVOKE ALL ON SEQUENCE public.hms_receipt_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.hms_receipt_seq TO service_role;

-- Hard guarantee for the managed series. Scoped to PULSE-% on purpose: three
-- legacy HMS-* numbers are already duplicated in production (each pair spanning
-- two different hostels — the exact failure this replaces), and renumbering a
-- receipt a resident already holds is worse than leaving the historical clash in
-- place. A number an operator types by hand therefore cannot collide with the
-- auto-issued series either.
CREATE UNIQUE INDEX IF NOT EXISTS hms_payments_receipt_number_pulse_uniq
  ON public.hms_payments (receipt_number)
  WHERE receipt_number LIKE 'PULSE-%';

NOTIFY pgrst, 'reload schema';
