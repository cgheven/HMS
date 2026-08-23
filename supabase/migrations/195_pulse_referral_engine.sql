-- ─────────────────────────────────────────────────────────────────────────────
-- A referral with no referrer must still pay the joining tenant and still bill Pulse
-- ─────────────────────────────────────────────────────────────────────────────
--
-- 194 made hms_referrals.referrer_tenant_id nullable so Pulse can be a referral
-- SOURCE. Nothing in the money engine could cope with that yet:
--
--   hms_grant_referral_rewards seeds itself with
--       JOIN hms_tenants rt ON rt.id = rf.referrer_tenant_id
--   which matches no row when the referrer is NULL. The SELECT is NOT FOUND, the
--   function returns 0 at its first guard, and BOTH sides are skipped — so the
--   joining tenant gets no discount, and because hms_attribute_referral gates on
--   `IF hms_grant_referral_rewards(...) > 0`, Pulse is never paid either.
--
-- Three edits below fix that. The referrer block is untouched and un-reindented
-- on purpose: this is the most money-critical function in the codebase and the
-- diff has to stay reviewable.
--
-- Economics this locks in:
--   tenant referral  = joining tenant's discount + referrer's discount + Pulse fee
--   Pulse  referral  = joining tenant's discount +                       Pulse fee
-- The owner pays strictly less on a Pulse admission, because there is no tenant
-- bounty to fund. Pulse's revenue is unchanged — it did the acquisition.
--
-- No change to hms_referral_rewards: 'referred' already means exactly what a
-- Pulse reward is, referrer_tenant_id there is already nullable, and every
-- NOT NULL column is sourced from the referral or the matched tenant.
--
-- hms_attribute_referral needs no change either. Its two referrer-dependent
-- guards read through the same inner join and therefore leave v_ref_tenant NULL,
-- which makes the self-referral test and the referrer's 90-day cap silent
-- no-ops — correct, since neither is meaningful without a referrer. The
-- equivalent Pulse abuse (a sitting resident submitting through their own
-- branch's link) is already stopped by hms_submit_referral's referrer-independent
-- already_resident check.

CREATE OR REPLACE FUNCTION public.hms_grant_referral_rewards(p_referral_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r                record;
  v_admit_month    text;
  v_expires        date;
  v_granted        integer := 0;
  v_pct            smallint;
  v_month          text;
  v_inserted       boolean;
  v_referred_paid  boolean;
  v_qual_month     text;
BEGIN
  SELECT rf.id, rf.owner_id, rf.name, rf.matched_tenant_id, rf.matched_at,
         rf.referrer_tenant_id, rf.promised_referrer_percent, rf.promised_referred_percent,
         mt.hostel_id  AS matched_hostel, mt.full_name AS matched_name,
         rt.hostel_id  AS referrer_hostel, rt.full_name AS referrer_name,
         rt.is_active  AS referrer_active, rt.is_waiting AS referrer_waiting,
         rt.check_out  AS referrer_check_out
    INTO r
    FROM hms_referrals rf
    JOIN hms_tenants mt ON mt.id = rf.matched_tenant_id
    -- LEFT: a Pulse referral has no referrer. An inner join here made the whole
    -- function a no-op for those rows.
    LEFT JOIN hms_tenants rt ON rt.id = rf.referrer_tenant_id
   WHERE rf.id = p_referral_id AND rf.status = 'joined';

  IF NOT FOUND THEN RETURN 0; END IF;

  v_admit_month := to_char(coalesce(r.matched_at, (now() at time zone 'Asia/Karachi')::date), 'YYYY-MM');
  -- REFERRAL_REWARD_EXPIRY_MONTHS = 3, mirrored in lib/referral-rewards.ts.
  v_expires := (to_date(v_admit_month || '-01','YYYY-MM-DD')
                + interval '4 months' - interval '1 day')::date;

  -- ── referred side ──────────────────────────────────────────────────────────
  -- LEAST(what the public page promised, what the branch that actually pays
  -- stands behind). The promise is honoured wherever the paying branch honours
  -- it; every branch keeps an absolute veto over its own P&L, and "set the
  -- percent to 0" stays a real switch for anything not yet granted.
  SELECT LEAST(r.promised_referred_percent,
               CASE WHEN h.referral_enabled THEN h.referral_referred_percent ELSE 0 END)
    INTO v_pct FROM hms_hostels h WHERE h.id = r.matched_hostel;

  IF coalesce(v_pct,0) < 1 THEN
    UPDATE hms_referrals SET rewards_skipped_reason =
      coalesce(rewards_skipped_reason,'') || 'referred_percent_zero;' WHERE id = p_referral_id;
  ELSE
    v_month := hms_referral_next_open_month(r.matched_tenant_id, v_admit_month, v_expires);
    IF v_month IS NOT NULL THEN
      INSERT INTO hms_referral_rewards
        (referral_id, owner_id, hostel_id, tenant_id, role, counterparty_name,
         referrer_tenant_id, matched_tenant_id, percent, status, for_month,
         earliest_month, expires_on)
      VALUES
        (p_referral_id, r.owner_id, r.matched_hostel, r.matched_tenant_id, 'referred',
         -- counterparty_name is a plain text snapshot; writing the literal here
         -- is the whole attribution channel for a Pulse referral — the Rewards
         -- tab renders and searches this column, so no UI or type change.
         coalesce(r.referrer_name, 'Pulse'),
         r.referrer_tenant_id, r.matched_tenant_id, v_pct, 'scheduled',
         v_month, v_admit_month, v_expires)
      ON CONFLICT DO NOTHING;
      -- Captured immediately: PERFORM below would reset FOUND.
      v_inserted := FOUND;
      IF v_inserted THEN
        v_granted := v_granted + 1;
        PERFORM hms_referral_touch_bill(r.matched_tenant_id, v_month);
      END IF;
    END IF;
  END IF;

  -- Pulse referral: stop here, do not fall through. The referrer block is not
  -- merely vacuous without a referrer — it is actively wrong. r.referrer_hostel
  -- is NULL, so the LEAST() below matches zero rows and PL/pgSQL assigns NULL to
  -- v_pct (it does NOT retain the referred-side value), `coalesce(v_pct,0) < 1`
  -- fires, and every Pulse admission gets stamped 'referrer_percent_zero;' —
  -- which app/actions/referrals.ts renders to the owner as "No reward — the
  -- discount was set to 0%" beside a discount that was in fact granted.
  -- Returning v_granted, not a literal: hms_attribute_referral's commission gate
  -- is `> 0` and needs the real count.
  IF r.referrer_tenant_id IS NULL THEN RETURN v_granted; END IF;

  -- ── referrer side ──────────────────────────────────────────────────────────
  SELECT LEAST(r.promised_referrer_percent,
               CASE WHEN h.referral_enabled THEN h.referral_referrer_percent ELSE 0 END)
    INTO v_pct FROM hms_hostels h WHERE h.id = r.referrer_hostel;

  IF coalesce(v_pct,0) < 1 THEN
    UPDATE hms_referrals SET rewards_skipped_reason =
      coalesce(rewards_skipped_reason,'') || 'referrer_percent_zero;' WHERE id = p_referral_id;
  ELSIF NOT (r.referrer_active AND NOT r.referrer_waiting
             AND (r.referrer_check_out IS NULL
                  OR r.referrer_check_out >= (now() at time zone 'Asia/Karachi')::date)) THEN
    UPDATE hms_referrals SET rewards_skipped_reason =
      coalesce(rewards_skipped_reason,'') || 'referrer_left;' WHERE id = p_referral_id;
  ELSE
    -- Qualification evaluated as a LEVEL, not assumed to be in the future. A
    -- re-grant after the referred person has already paid must land 'scheduled',
    -- not 'held' waiting for an event that already happened.
    SELECT EXISTS (SELECT 1 FROM hms_payments p
                    WHERE p.tenant_id = r.matched_tenant_id
                      AND NOT p.is_reservation AND p.status IN ('paid','waived'))
      INTO v_referred_paid;

    IF v_referred_paid THEN
      v_qual_month := greatest(v_admit_month, to_char((now() at time zone 'Asia/Karachi')::date,'YYYY-MM'));
      v_month := hms_referral_next_open_month(r.referrer_tenant_id, v_qual_month, v_expires);
      IF v_month IS NOT NULL THEN
        INSERT INTO hms_referral_rewards
          (referral_id, owner_id, hostel_id, tenant_id, role, counterparty_name,
           referrer_tenant_id, matched_tenant_id, percent, status, for_month,
           earliest_month, expires_on, qualified_at)
        VALUES
          (p_referral_id, r.owner_id, r.referrer_hostel, r.referrer_tenant_id, 'referrer',
           r.matched_name, r.referrer_tenant_id, r.matched_tenant_id, v_pct, 'scheduled',
           v_month, v_admit_month, v_expires, now())
        ON CONFLICT DO NOTHING;
        v_inserted := FOUND;
        IF v_inserted THEN
          v_granted := v_granted + 1;
          PERFORM hms_referral_touch_bill(r.referrer_tenant_id, v_month);
        END IF;
      END IF;
    ELSE
      INSERT INTO hms_referral_rewards
        (referral_id, owner_id, hostel_id, tenant_id, role, counterparty_name,
         referrer_tenant_id, matched_tenant_id, percent, status, for_month,
         earliest_month, expires_on)
      VALUES
        (p_referral_id, r.owner_id, r.referrer_hostel, r.referrer_tenant_id, 'referrer',
         r.matched_name, r.referrer_tenant_id, r.matched_tenant_id, v_pct, 'held',
         NULL, v_admit_month, v_expires)
      ON CONFLICT DO NOTHING;
      IF FOUND THEN v_granted := v_granted + 1; END IF;
    END IF;
  END IF;

  RETURN v_granted;
END;
$function$;


-- ─────────────────────────────────────────────────────────────────────────────
-- The reconciler may RE-price a fee. It must never ORIGINATE one.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- 192 and 193 gave this loop its job: walk a branch's joined referrals and let
-- hms_charge_pulse_commission repair a reversal that no longer stands or a fee
-- that no longer matches the rent. It walks them UNCONDITIONALLY, with no
-- equivalent of hms_attribute_referral's `IF hms_grant_referral_rewards(...) > 0`
-- gate — so it will happily invent a first-ever fee for a referral that granted
-- nobody anything.
--
-- That was already wrong for tenant referrals where both percentages are 0 or
-- the referrer had checked out; it is merely rare there. Pulse would make it
-- certain: if the grant fix above ever regresses, every Pulse admission becomes
-- a fee for nothing within one Payments page load (lib/referral-rewards.ts calls
-- this on every load) plus the nightly cron.
--
-- pulse_commission_charged_at IS NOT NULL keeps 192's case working —
-- hms_reverse_pulse_commission preserves charged_at, so a reversed-then-restored
-- referral still qualifies as "a fee that was legitimately incurred".

CREATE OR REPLACE FUNCTION public.hms_referral_heal_commissions(p_hostel_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
