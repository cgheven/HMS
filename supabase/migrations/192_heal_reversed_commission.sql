-- ─────────────────────────────────────────────────────────────────────────────
-- A reversed Pulse commission must come back if the rejection does not stand
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Observed in production. A referral was matched and charged Rs 3,800 at
-- 08:48:50, rejected at 08:59:32 — which correctly reversed the fee — and the
-- rejection was undone three seconds later. The tenant is joined, the tenant's
-- discount is applied, the owner keeps the referral. Pulse keeps nothing.
--
-- Why it could never recover on its own: hms_charge_pulse_commission selects
--
--     AND rf.pulse_commission_amount IS NULL
--     AND rf.pulse_commission_reversed_at IS NULL
--
-- so a row that has EVER been charged and reversed is refused forever. The only
-- thing that could restore it was hms_unreverse_pulse_commission, called from
-- exactly one branch of undoRejectReferral — the one that runs when the undo
-- restores straight to 'joined'. When the undo restores to 'pending' and
-- attribution re-joins the referral afterwards, that branch never runs, and
-- nothing downstream tries again.
--
-- The fix makes the CHARGE self-healing rather than adding a second place that
-- must remember to call the un-reverse. Both existing callers —
-- hms_attribute_referral and the rent-change trigger — and the reconciler now
-- repair the row automatically.
--
-- Safe by construction: healing requires status = 'joined'. A genuinely
-- rejected referral is status = 'rejected', and hms_attribute_referral only
-- promotes rows that are still 'pending', so a rejection that stands can never
-- be reached by this path.

create or replace function public.hms_charge_pulse_commission(p_referral_id uuid)
returns numeric
language plpgsql
security definer
set search_path to 'public'
as $$
DECLARE
  v_hostel  uuid;
  v_rent    numeric(10,2);
  v_waiting boolean;
  v_pct     smallint;
  v_amount  numeric(10,2);
  v_healed  numeric(10,2);
BEGIN
  -- Heal first. A joined referral carrying a reversed fee is a rejection that
  -- was undone: the discounts came back, so the fee does too, at the amount it
  -- was originally charged rather than re-derived from today's rate.
  UPDATE hms_referrals
     SET pulse_commission_reversed_at = NULL
   WHERE id = p_referral_id
     AND status = 'joined'
     AND pulse_commission_amount IS NOT NULL
     AND pulse_commission_reversed_at IS NOT NULL
  RETURNING pulse_commission_amount INTO v_healed;

  IF v_healed IS NOT NULL THEN
    RETURN v_healed;
  END IF;

  SELECT mt.hostel_id, coalesce(mt.monthly_rent, 0), coalesce(mt.is_waiting, false)
    INTO v_hostel, v_rent, v_waiting
    FROM hms_referrals rf
    JOIN hms_tenants mt ON mt.id = rf.matched_tenant_id
   WHERE rf.id = p_referral_id
     AND rf.status = 'joined'
     AND rf.pulse_commission_amount IS NULL
     AND rf.pulse_commission_reversed_at IS NULL;

  IF NOT FOUND THEN RETURN 0; END IF;

  -- LEAVE IT NULL RATHER THAN STAMP A ZERO.
  --
  -- A waiting-list tenant or an unpriced room means the fee cannot be computed
  -- YET, not that it is nil. Writing 0.00 here would satisfy the IS NULL guard
  -- above forever and the branch would never be billed for this conversion.
  IF v_waiting OR v_rent <= 0 THEN RETURN 0; END IF;

  v_pct := hms_pulse_commission_percent(v_hostel);
  IF v_pct <= 0 THEN RETURN 0; END IF;

  v_amount := round(v_rent * v_pct / 100.0, 2);

  UPDATE hms_referrals
     SET pulse_commission_percent   = v_pct,
         pulse_commission_amount    = v_amount,
         pulse_commission_charged_at = now()
   WHERE id = p_referral_id;

  RETURN v_amount;
END;
$$;

revoke all on function public.hms_charge_pulse_commission(uuid) from public, anon, authenticated;
grant execute on function public.hms_charge_pulse_commission(uuid) to service_role;

-- Repairs anything already stranded, and keeps repairing on every reconcile
-- pass — which runs on each Payments page load and nightly from the cron. One
-- statement, no loop: the set is tiny and this is a corrective sweep, not a
-- per-referral decision.
create or replace function public.hms_referral_heal_commissions(p_hostel_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
DECLARE
  v_n integer;
BEGIN
  UPDATE hms_referrals
     SET pulse_commission_reversed_at = NULL
   WHERE hostel_id = p_hostel_id
     AND status = 'joined'
     AND pulse_commission_amount IS NOT NULL
     AND pulse_commission_reversed_at IS NOT NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

revoke all on function public.hms_referral_heal_commissions(uuid) from public, anon, authenticated;
grant execute on function public.hms_referral_heal_commissions(uuid) to service_role;
