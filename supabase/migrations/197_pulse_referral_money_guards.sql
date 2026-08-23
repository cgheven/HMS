-- Pulse referral source, part 4: money guards.
--
-- Three defects found by exercising a real Pulse admission end to end on stage.
-- Two of them are pre-existing and affect TENANT referrals just as much; they
-- only became visible because the Pulse path forced the whole conversion
-- lifecycle to be walked for the first time.

-- ── 1. hms_referral_find_pending ────────────────────────────────────────────
-- Pending referrals are matched on (owner_id, phone_digits) with no branch
-- filter. For a TENANT referral that is arguable — the referrer really may live
-- at a sibling branch. For a PULSE referral it is simply wrong: the code IS the
-- branch, so a lead generated for branch A that walks into branch B was
-- invoiced to A while the discount landed on B, and neither branch's Marketing
-- page could be reconciled against the other's.
--
-- The old four-argument signature is DROPPED so a four-argument call resolves
-- unambiguously to this body with p_hostel_id defaulting to NULL (= no branch
-- restriction, i.e. exactly the old behaviour). That keeps the currently
-- deployed app working between the migration and the deploy.
drop function if exists public.hms_referral_find_pending(uuid, text, date, integer);

create or replace function public.hms_referral_find_pending(
  p_owner_id      uuid,
  p_phone_digits  text,
  p_as_of         date,
  p_ttl_days      integer,
  p_hostel_id     uuid default null
)
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $function$
  SELECT r.id
    FROM hms_referrals r
   WHERE r.owner_id = p_owner_id
     AND r.phone_digits = p_phone_digits
     AND r.status = 'pending'
     AND p_as_of >= (r.created_at at time zone 'Asia/Karachi')::date
     AND p_as_of <= (r.created_at at time zone 'Asia/Karachi')::date + p_ttl_days
     -- A Pulse lead belongs to the branch whose link produced it. Tenant
     -- referrals keep their existing owner-wide reach.
     AND (r.source <> 'pulse' OR p_hostel_id IS NULL OR r.hostel_id = p_hostel_id)
   ORDER BY r.created_at ASC
   LIMIT 1;
$function$;

revoke all on function public.hms_referral_find_pending(uuid, text, date, integer, uuid) from public, anon, authenticated;
grant execute on function public.hms_referral_find_pending(uuid, text, date, integer, uuid) to service_role;

-- ── 2. hms_attribute_referral ───────────────────────────────────────────────
create or replace function public.hms_attribute_referral(
  p_tenant_id uuid, p_hostel_id uuid, p_phone_digits text,
  p_check_in date, p_ttl_days integer
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_owner_id    uuid;
  v_referral_id uuid;
  v_ref_tenant  uuid;
  v_ref_digits  text;
  v_claimed     boolean;
  v_admitted    date := coalesce(p_check_in, (now() at time zone 'Asia/Karachi')::date);
BEGIN
  IF p_phone_digits IS NULL OR btrim(p_phone_digits) = '' THEN RETURN false; END IF;

  SELECT h.owner_id INTO v_owner_id
    FROM hms_hostels h WHERE h.id = p_hostel_id AND h.referral_enabled;
  IF NOT FOUND THEN RETURN false; END IF;

  -- p_hostel_id is now passed through: a Pulse lead is only claimable at the
  -- branch whose link produced it.
  v_referral_id := hms_referral_find_pending(v_owner_id, p_phone_digits, v_admitted,
                                             p_ttl_days, p_hostel_id);
  IF v_referral_id IS NULL THEN RETURN false; END IF;

  -- LEFT JOIN, so the intent is explicit. It behaved correctly before only
  -- because SELECT INTO over zero rows leaves the locals NULL and every test
  -- below happens to be NULL-safe; a future STRICT or NOT FOUND guard added to
  -- this block would have silently killed Pulse attribution.
  SELECT r.referrer_tenant_id, t.phone_digits INTO v_ref_tenant, v_ref_digits
    FROM hms_referrals r LEFT JOIN hms_tenants t ON t.id = r.referrer_tenant_id
   WHERE r.id = v_referral_id;

  IF p_tenant_id = v_ref_tenant
     OR (v_ref_digits IS NOT NULL AND v_ref_digits = p_phone_digits) THEN
    UPDATE hms_referrals SET status='rejected', rejected_at=now(),
           rewards_skipped_reason='self_referral' WHERE id = v_referral_id;
    RETURN false;
  END IF;

  -- matched_tenant_id, not status='joined': it is written ONLY by this function,
  -- so it means "this phone has already been converted once" regardless of any
  -- later status edit. Keyed on status alone, the sequence reject -> back to
  -- waiting -> new submission -> reactivate charges the same admission twice.
  --
  -- `OR x.status = 'joined'` added: matched_tenant_id has an ON DELETE SET NULL
  -- FK, so DELETING the tenant who joined blanked it and re-opened the phone for
  -- a second conversion — the same person could be billed for twice. Widening
  -- this test is strictly more blocking, so the original reasoning still holds.
  IF EXISTS (SELECT 1 FROM hms_referrals x
              WHERE x.owner_id=v_owner_id AND x.phone_digits=p_phone_digits
                AND (x.matched_tenant_id IS NOT NULL OR x.status = 'joined')
                AND x.id <> v_referral_id) THEN
    UPDATE hms_referrals SET status='rejected', rejected_at=now(),
           rewards_skipped_reason='already_referred' WHERE id = v_referral_id;
    RETURN false;
  END IF;

  -- Vacuous for Pulse by design (v_ref_tenant is NULL, so the count is 0): the
  -- 90-day abuse cap exists to stop one resident farming rewards, and there is
  -- no resident here. The Pulse link's own ceiling lives in hms_submit_referral.
  IF (SELECT count(*) FROM hms_referral_rewards w
       WHERE w.tenant_id = v_ref_tenant AND w.role='referrer'
         AND w.status <> 'void' AND w.created_at > now() - interval '90 days') >= 6 THEN
    UPDATE hms_referrals SET rewards_skipped_reason='referrer_cap_90d' WHERE id = v_referral_id;
  END IF;

  UPDATE hms_referrals
     SET status='joined', matched_tenant_id=p_tenant_id, matched_at=v_admitted
   WHERE id = v_referral_id AND status = 'pending';

  v_claimed := FOUND;
  IF v_claimed THEN
    -- Charged only when the referral actually paid somebody. A conversion where
    -- both percentages are 0, or the referrer has checked out, or they are at
    -- their 90-day cap, grants zero rewards — and billing the owner for a
    -- programme that gave nobody anything is a fee for nothing. The re-charge
    -- trigger picks it up later if the rent was simply not known yet.
    IF hms_grant_referral_rewards(v_referral_id) > 0 THEN
      PERFORM hms_charge_pulse_commission(v_referral_id);
    END IF;
  END IF;
  RETURN v_claimed;
END;
$function$;

-- ── 3. hms_charge_pulse_commission ──────────────────────────────────────────
-- Two guards, both about not billing for a discount that does not exist.
create or replace function public.hms_charge_pulse_commission(p_referral_id uuid)
returns numeric
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_hostel  uuid;
  v_rent    numeric(10,2);
  v_waiting boolean;
  v_pct     smallint;
  v_amount  numeric(10,2);
  v_healed  numeric(10,2);
  v_current numeric(10,2);
  v_today   date := (now() at time zone 'Asia/Karachi')::date;
BEGIN
  -- Heal a reversal that no longer stands (migration 192). Runs before the
  -- recompute below so a restored fee is then also re-priced in the same call.
  --
  -- Gated on the matched tenant still existing: without that, a fee reversed
  -- because the joining tenant was deleted was immediately un-reversed by the
  -- next healer pass, so the reversal could never stick.
  UPDATE hms_referrals rf
     SET pulse_commission_reversed_at = NULL
   WHERE rf.id = p_referral_id
     AND rf.status = 'joined'
     AND rf.pulse_commission_amount IS NOT NULL
     AND rf.pulse_commission_reversed_at IS NOT NULL
     AND EXISTS (SELECT 1 FROM hms_tenants mt WHERE mt.id = rf.matched_tenant_id)
  RETURNING rf.pulse_commission_amount INTO v_healed;

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
  IF v_waiting OR v_rent <= 0 THEN RETURN coalesce(v_current, v_healed, 0); END IF;

  -- ORIGINATION GATE. A fee may only be created while a usable discount exists.
  -- Re-pricing an already-charged fee (migrations 192/193) is untouched, because
  -- that path has pulse_commission_charged_at set.
  --
  -- The case this catches: a lead admitted straight onto the waiting list has
  -- its discount pinned to the ADMIT month with a four-month expiry, but the fee
  -- is only stamped when they are activated. Activate them five months later and
  -- the owner was billed in full for a discount the tenant could no longer
  -- receive. Same shape for a conversion whose only reward was voided.
  IF v_current IS NULL
     AND (SELECT pulse_commission_charged_at FROM hms_referrals WHERE id = p_referral_id) IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM hms_referral_rewards rw
        WHERE rw.referral_id = p_referral_id
          AND rw.status NOT IN ('void', 'expired')
          AND (rw.status = 'applied' OR rw.expires_on IS NULL OR rw.expires_on >= v_today)
     ) THEN
    RETURN 0;
  END IF;

  v_pct := hms_pulse_commission_percent(v_hostel);
  IF v_pct <= 0 THEN RETURN coalesce(v_current, v_healed, 0); END IF;

  v_amount := round(v_rent * v_pct / 100.0, 2);

  IF v_current IS NOT NULL AND v_current = v_amount
     AND (SELECT pulse_commission_percent FROM hms_referrals WHERE id = p_referral_id) = v_pct THEN
    RETURN v_amount;
  END IF;

  UPDATE hms_referrals
     SET pulse_commission_percent = v_pct,
         pulse_commission_amount  = v_amount,
         -- Preserved on a correction. The fee was incurred when the referral
         -- converted, and monthly reporting buckets on this column.
         pulse_commission_charged_at = coalesce(pulse_commission_charged_at, now())
   WHERE id = p_referral_id;

  RETURN v_amount;
END;
$function$;

-- ── 4. hms_referral_heal_commissions ────────────────────────────────────────
-- The reconciler now REVERSES as well as re-prices.
--
-- hms_referrals.matched_tenant_id is ON DELETE SET NULL while
-- hms_referral_rewards.tenant_id is ON DELETE CASCADE, so deleting the tenant
-- who joined destroys the discount rows and leaves the referral 'joined' with a
-- live fee and nothing behind it. That is the owner paying for a conversion that
-- no longer exists anywhere in the system.
create or replace function public.hms_referral_heal_commissions(p_hostel_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  r        record;
  v_n      integer := 0;
  v_before numeric(10,2);
BEGIN
  FOR r IN
    SELECT rf.id
      FROM hms_referrals rf
     WHERE rf.hostel_id = p_hostel_id
       AND rf.status = 'joined'
       AND rf.matched_tenant_id IS NULL
       AND rf.pulse_commission_amount IS NOT NULL
       AND rf.pulse_commission_reversed_at IS NULL
  LOOP
    PERFORM hms_reverse_pulse_commission(r.id, 'matched_tenant_deleted');
    v_n := v_n + 1;
  END LOOP;

  FOR r IN
    SELECT rf.id, rf.pulse_commission_amount AS before_amount
      FROM hms_referrals rf
     WHERE rf.hostel_id = p_hostel_id
       AND rf.status = 'joined'
       -- Orphans are handled above and must not be re-priced back to life.
       AND rf.matched_tenant_id IS NOT NULL
       AND (rf.pulse_commission_charged_at IS NOT NULL
            OR EXISTS (SELECT 1 FROM hms_referral_rewards rw
                        WHERE rw.referral_id = rf.id AND rw.status <> 'void'))
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
$function$;
