-- ─────────────────────────────────────────────────────────────────────────────
-- Keep the Pulse commission in step with the rent it is a percentage OF
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Found in production. Two referrals, one branch, both at 20%:
--
--   Musab   rent 19,000   commission 3,800   correct
--   Aaniq   rent 15,000   commission 3,800   should be 3,000 — overcharged 800
--
-- Aaniq was admitted at 19,000 and his rent was corrected to 15,000 afterwards.
-- His DISCOUNT followed the correction (Rs 1,500 = 10% of 15,000, applied). His
-- commission did not, because hms_charge_pulse_commission selects
--
--     AND rf.pulse_commission_amount IS NULL
--
-- and so refuses any row it has already priced. hms_recharge_pulse_commission_on_rent
-- exists precisely to handle a rent change and calls that function — where it
-- has always silently no-opped. The trigger has never been able to do its job.
--
-- The result is the worst kind of billing error: the tenant's side re-derives,
-- the platform's side does not, and the two quietly disagree on the same rent.
-- Nothing surfaces it, because each number looks plausible alone.
--
-- The charge is now idempotent-with-correction rather than write-once: it
-- recomputes and updates when the stored amount no longer matches the rent.
-- charged_at is preserved — the fee was incurred when the referral converted,
-- not when we corrected the arithmetic — and the month a fee is reported in is
-- bucketed on charged_at.
--
-- KNOWN LIMIT, deliberately not solved here: the base is the tenant's CURRENT
-- monthly_rent, so a genuine rent rise months later would also move the fee.
-- The correct base is the rent of the referred tenant's FIRST month, which this
-- schema does not record anywhere — hms_payments carries the billed amount, not
-- the rate. Fixing that means capturing the first-month rate at conversion, and
-- it should not ride along with a correction that is stopping an active
-- overcharge. Until then, tracking current rent is strictly better than being
-- frozen at a value that was never right.

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
  v_current numeric(10,2);
BEGIN
  -- Heal a reversal that no longer stands (migration 192). Runs before the
  -- recompute below so a restored fee is then also re-priced in the same call.
  UPDATE hms_referrals
     SET pulse_commission_reversed_at = NULL
   WHERE id = p_referral_id
     AND status = 'joined'
     AND pulse_commission_amount IS NOT NULL
     AND pulse_commission_reversed_at IS NOT NULL
  RETURNING pulse_commission_amount INTO v_healed;

  -- Price the referral from the tenant it actually matched. Note the absence of
  -- `pulse_commission_amount IS NULL`: a row that has been priced before is
  -- eligible to be RE-priced, which is the whole point of this migration.
  SELECT mt.hostel_id, coalesce(mt.monthly_rent, 0), coalesce(mt.is_waiting, false),
         rf.pulse_commission_amount
    INTO v_hostel, v_rent, v_waiting, v_current
    FROM hms_referrals rf
    JOIN hms_tenants mt ON mt.id = rf.matched_tenant_id
   WHERE rf.id = p_referral_id
     AND rf.status = 'joined'
     AND rf.pulse_commission_reversed_at IS NULL;

  IF NOT FOUND THEN RETURN coalesce(v_healed, 0); END IF;

  -- LEAVE IT NULL RATHER THAN STAMP A ZERO.
  --
  -- A waiting-list tenant or an unpriced room means the fee cannot be computed
  -- YET, not that it is nil. Writing 0.00 would satisfy a null-check forever and
  -- the branch would never be billed for this conversion. For the same reason a
  -- row that is ALREADY priced is left alone here rather than zeroed: a tenant
  -- moved back to the waiting list must not erase a fee already incurred.
  IF v_waiting OR v_rent <= 0 THEN RETURN coalesce(v_current, v_healed, 0); END IF;

  v_pct := hms_pulse_commission_percent(v_hostel);
  IF v_pct <= 0 THEN RETURN coalesce(v_current, v_healed, 0); END IF;

  v_amount := round(v_rent * v_pct / 100.0, 2);

  -- Nothing to do when it already agrees. Guarding here rather than relying on
  -- the UPDATE being harmless keeps the rent trigger from writing on every
  -- unrelated tenant edit, which would churn updated_at across the table.
  IF v_current IS NOT NULL AND v_current = v_amount
     AND (SELECT pulse_commission_percent FROM hms_referrals WHERE id = p_referral_id) = v_pct THEN
    RETURN v_amount;
  END IF;

  UPDATE hms_referrals
     SET pulse_commission_percent = v_pct,
         pulse_commission_amount  = v_amount,
         -- Preserved on a correction. The fee was incurred when the referral
         -- converted, and monthly reporting buckets on this column — restamping
         -- it would move an old fee into the current month's figures.
         pulse_commission_charged_at = coalesce(pulse_commission_charged_at, now())
   WHERE id = p_referral_id;

  RETURN v_amount;
END;
$$;

revoke all on function public.hms_charge_pulse_commission(uuid) from public, anon, authenticated;
grant execute on function public.hms_charge_pulse_commission(uuid) to service_role;

-- The heal sweep from 192 now also re-prices, so a stale fee is corrected by the
-- same reconcile pass that repairs a reversal — on every Payments load and
-- nightly from the cron.
create or replace function public.hms_referral_heal_commissions(p_hostel_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
DECLARE
  r       record;
  v_n     integer := 0;
  v_before numeric(10,2);
BEGIN
  FOR r IN
    SELECT rf.id, rf.pulse_commission_amount AS before_amount
      FROM hms_referrals rf
     WHERE rf.hostel_id = p_hostel_id
       AND rf.status = 'joined'
  LOOP
    v_before := r.before_amount;
    PERFORM hms_charge_pulse_commission(r.id);
    SELECT pulse_commission_amount INTO v_before
      FROM hms_referrals WHERE id = r.id;
    IF v_before IS DISTINCT FROM r.before_amount THEN
      v_n := v_n + 1;
    END IF;
  END LOOP;
  RETURN v_n;
END;
$$;

revoke all on function public.hms_referral_heal_commissions(uuid) from public, anon, authenticated;
grant execute on function public.hms_referral_heal_commissions(uuid) to service_role;

-- The rent trigger carried the same write-once guard, so a rent change on an
-- already-priced referral never even reached the function above. Dropping
-- `pulse_commission_amount IS NULL` is what actually connects a rent correction
-- to the fee; the recompute logic lives in hms_charge_pulse_commission, which
-- no-ops when the amount already agrees.
create or replace function public.hms_recharge_pulse_commission_on_rent()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
DECLARE r record;
BEGIN
  IF (new.monthly_rent IS DISTINCT FROM old.monthly_rent
      OR (coalesce(old.is_waiting, false) AND NOT coalesce(new.is_waiting, false)))
     AND coalesce(new.monthly_rent, 0) > 0
     AND NOT coalesce(new.is_waiting, false) THEN
    FOR r IN SELECT rf.id FROM hms_referrals rf
              WHERE rf.matched_tenant_id = new.id
                AND rf.status = 'joined'
                AND rf.pulse_commission_reversed_at IS NULL
    LOOP
      PERFORM hms_charge_pulse_commission(r.id);
    END LOOP;
  END IF;
  RETURN new;
END;
$$;

revoke all on function public.hms_recharge_pulse_commission_on_rent() from public, anon, authenticated;
grant execute on function public.hms_recharge_pulse_commission_on_rent() to service_role;
