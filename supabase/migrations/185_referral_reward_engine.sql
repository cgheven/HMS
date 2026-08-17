-- Referral Phase 2, part 2: the reward engine. Functions and settlement triggers.
--
-- Every function here is SECURITY DEFINER with a pinned search_path, and is
-- revoked from public/anon/authenticated and granted only to service_role —
-- the same posture as migrations 174/177/178. Nothing in this file is reachable
-- without the service key.
--
-- For the 14 branches that never enable referrals, every path below terminates
-- on an empty partial index or an early return. hms_payments.referral_discount
-- stays 0 on all 1,425 existing rows.

-- ── 1. The shared matching predicate ─────────────────────────────────────────
-- Extracted so the admission BANNER and the attribution RPC cannot disagree.
-- It is structurally impossible for the screen to promise a discount the RPC
-- will refuse, because both call this.
create or replace function public.hms_referral_find_pending(
  p_owner_id     uuid,
  p_phone_digits text,
  p_as_of        date,
  p_ttl_days     integer
) returns uuid
language sql stable security definer set search_path = public as $$
  SELECT r.id
    FROM hms_referrals r
   WHERE r.owner_id = p_owner_id
     AND r.phone_digits = p_phone_digits
     AND r.status = 'pending'
     AND p_as_of >= (r.created_at at time zone 'Asia/Karachi')::date
     AND p_as_of <= (r.created_at at time zone 'Asia/Karachi')::date + p_ttl_days
   ORDER BY r.created_at ASC
   LIMIT 1;
$$;
revoke all on function public.hms_referral_find_pending(uuid, text, date, integer) from public, anon, authenticated;
grant execute on function public.hms_referral_find_pending(uuid, text, date, integer) to service_role;

-- ── 2. Can a reward sit on this month? ONE definition, used everywhere ───────
-- 'waived' counts as occupied: a waived bill is settled history.
-- is_reservation counts as occupied: hms_payments is unique on
-- (tenant_id, for_month), so a reservation month can never hold a rent bill, and
-- the trigger forces referral_discount := 0 on reservation rows — a reward
-- placed there would be permanently stuck.
create or replace function public.hms_referral_month_occupied(
  p_tenant_id uuid, p_month text, p_exclude_reward uuid default null
) returns boolean
language sql stable security definer set search_path = public as $$
  SELECT EXISTS (
    SELECT 1 FROM hms_referral_rewards w
     WHERE w.tenant_id = p_tenant_id AND w.for_month = p_month
       AND w.status IN ('scheduled','applied')
       AND (p_exclude_reward IS NULL OR w.id <> p_exclude_reward)
  ) OR EXISTS (
    SELECT 1 FROM hms_payments p
     WHERE p.tenant_id = p_tenant_id AND p.for_month = p_month
       AND (p.is_reservation OR p.status IN ('paid','partially_paid','waived'))
  );
$$;
revoke all on function public.hms_referral_month_occupied(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.hms_referral_month_occupied(uuid, text, uuid) to service_role;

-- ── 3. Where does it land? ───────────────────────────────────────────────────
create or replace function public.hms_referral_next_open_month(
  p_tenant_id uuid, p_from_month text, p_expires_on date, p_exclude_reward uuid default null
) returns text
language plpgsql stable security definer set search_path = public as $$
DECLARE v_m date := to_date(p_from_month || '-01', 'YYYY-MM-DD'); i int;
BEGIN
  FOR i IN 0..11 LOOP
    IF (v_m + interval '1 month' - interval '1 day')::date > p_expires_on THEN
      RETURN NULL;
    END IF;
    IF NOT hms_referral_month_occupied(p_tenant_id, to_char(v_m,'YYYY-MM'), p_exclude_reward) THEN
      RETURN to_char(v_m, 'YYYY-MM');
    END IF;
    v_m := (v_m + interval '1 month')::date;
  END LOOP;
  RETURN NULL;
END;
$$;
revoke all on function public.hms_referral_next_open_month(uuid, text, date, uuid) from public, anon, authenticated;
grant execute on function public.hms_referral_next_open_month(uuid, text, date, uuid) to service_role;

-- ── 4. Re-price a bill in place ──────────────────────────────────────────────
-- A no-op touch: the BEFORE trigger does the arithmetic. Deliberately never
-- touches a collected bill — money already collected is never rewritten.
create or replace function public.hms_referral_touch_bill(p_tenant_id uuid, p_month text)
returns void
language sql security definer set search_path = public as $$
  UPDATE hms_payments SET updated_at = now()
   WHERE tenant_id = p_tenant_id AND for_month = p_month
     AND status IN ('pending','overdue') AND NOT is_reservation;
$$;
revoke all on function public.hms_referral_touch_bill(uuid, text) from public, anon, authenticated;
grant execute on function public.hms_referral_touch_bill(uuid, text) to service_role;

-- ── 5. THE ONLY WRITER OF REWARD ROWS ────────────────────────────────────────
create or replace function public.hms_grant_referral_rewards(p_referral_id uuid)
returns integer
language plpgsql security definer set search_path = public as $$
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
    JOIN hms_tenants rt ON rt.id = rf.referrer_tenant_id
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
         r.referrer_name, r.referrer_tenant_id, r.matched_tenant_id, v_pct, 'scheduled',
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
$$;
revoke all on function public.hms_grant_referral_rewards(uuid) from public, anon, authenticated;
grant execute on function public.hms_grant_referral_rewards(uuid) to service_role;

-- ── 6. Detach (reversible) and void (permanent) ──────────────────────────────
-- DETACH is what the Active -> Waiting revert uses. Voiding there was
-- unrecoverable, because attribution is a one-shot pending->joined transition
-- and can never re-grant. Detach keeps the reward alive and unplaced; the
-- reconciler re-places it on re-activation.
create or replace function public.hms_detach_referral_rewards(
  p_tenant_id uuid, p_from_month text, p_reason text
) returns integer
language plpgsql security definer set search_path = public as $$
DECLARE v_n integer := 0; w record;
BEGIN
  FOR w IN SELECT id, tenant_id, for_month FROM hms_referral_rewards
            WHERE tenant_id = p_tenant_id AND status = 'scheduled'
              AND for_month >= p_from_month
  LOOP
    UPDATE hms_referral_rewards
       SET status = 'held', for_month = NULL, void_reason = p_reason
     WHERE id = w.id;
    PERFORM hms_referral_touch_bill(w.tenant_id, w.for_month);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;
revoke all on function public.hms_detach_referral_rewards(uuid, text, text) from public, anon, authenticated;
grant execute on function public.hms_detach_referral_rewards(uuid, text, text) to service_role;

-- Two functions, not one overload: PostgREST resolves by ARGUMENT NAME, and a
-- name mismatch is a silent PGRST202. Rejecting a referral must void BOTH sides,
-- which live on two tenants at possibly two branches, so (tenant_id, from_month)
-- cannot express it.
create or replace function public.hms_void_referral_rewards_for_referral(
  p_referral_id uuid, p_reason text
) returns integer
language plpgsql security definer set search_path = public as $$
DECLARE v_n integer := 0; w record;
BEGIN
  FOR w IN SELECT id, tenant_id, for_month FROM hms_referral_rewards
            WHERE referral_id = p_referral_id AND status IN ('scheduled','held')
  LOOP
    UPDATE hms_referral_rewards
       SET status='void', voided_at=now(), void_reason=p_reason, for_month=NULL
     WHERE id = w.id;
    IF w.for_month IS NOT NULL THEN PERFORM hms_referral_touch_bill(w.tenant_id, w.for_month); END IF;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;
revoke all on function public.hms_void_referral_rewards_for_referral(uuid, text) from public, anon, authenticated;
grant execute on function public.hms_void_referral_rewards_for_referral(uuid, text) to service_role;

-- for_month IS NULL is matched deliberately: a checkout must be able to cancel a
-- 'held' payout that has not been placed yet.
create or replace function public.hms_void_referral_rewards_for_tenant(
  p_tenant_id uuid, p_from_month text, p_reason text
) returns integer
language plpgsql security definer set search_path = public as $$
DECLARE v_n integer := 0; w record;
BEGIN
  FOR w IN SELECT id, tenant_id, for_month FROM hms_referral_rewards
            WHERE tenant_id = p_tenant_id AND status IN ('scheduled','held')
              AND (for_month IS NULL OR for_month >= p_from_month)
  LOOP
    UPDATE hms_referral_rewards
       SET status='void', voided_at=now(), void_reason=p_reason, for_month=NULL
     WHERE id = w.id;
    IF w.for_month IS NOT NULL THEN PERFORM hms_referral_touch_bill(w.tenant_id, w.for_month); END IF;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;
revoke all on function public.hms_void_referral_rewards_for_tenant(uuid, text, text) from public, anon, authenticated;
grant execute on function public.hms_void_referral_rewards_for_tenant(uuid, text, text) to service_role;

-- ── 7. Settlement trigger — Job A (retire) and Job B (release) ───────────────
-- TWO triggers, not one combined AFTER INSERT OR UPDATE: a combined trigger's
-- WHEN clause may not reference OLD, and INSERT coverage is required because
-- backfillTenantPaymentsAction and recordReservationDepositAction create rows
-- that are BORN settled.
create or replace function public.hms_referral_on_payment_settled()
returns trigger
language plpgsql security definer set search_path = public as $$
DECLARE v_ref record; v_month text; v_prev_settled boolean;
BEGIN
  v_prev_settled := (TG_OP = 'UPDATE'
                     AND old.status IN ('paid','partially_paid','waived'));

  -- Job A: a settled bill retires the reward sitting on it. One place instead of
  -- six call sites (mark-paid, partial, waive, checkout settle, checkout waive,
  -- AC top-up).
  --
  -- NOT is_reservation is load-bearing. A reservation row is always born 'paid'
  -- and the trigger forces its referral_discount to 0, so without this guard a
  -- deposit collected in the same month as a queued reward would retire that
  -- reward with applied_amount = 0 — the tenant's welcome discount spent on a
  -- refundable deposit that never carried it.
  IF new.status IN ('paid','partially_paid','waived') AND NOT v_prev_settled
     AND NOT new.is_reservation THEN
    BEGIN
      UPDATE hms_referral_rewards
         SET status='applied', applied_amount=new.referral_discount,
             applied_payment_id=new.id, applied_at=now(),
             void_reason = CASE WHEN new.status='waived' THEN 'bill_waived' ELSE void_reason END
       WHERE tenant_id = new.tenant_id AND for_month = new.for_month AND status='scheduled';
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[referral] job A failed for payment %: %', new.id, SQLERRM;
    END;
  END IF;

  -- Job B: money arrived, so the referrer's payout is released.
  -- 'paid' only. A waived first bill means no money arrived; the held row is
  -- expired with a reason the owner can see rather than paid out silently.
  --
  -- IT DOES NOT TOUCH THE REFERRER'S BILL. Doing so locks a second tenant's
  -- payment row inside a collection transaction and deadlocks ABBA against a
  -- concurrent collection of that referrer's own bill. The reconciler's step 3
  -- prices it, and payments-client.tsx calls syncMonth() immediately after every
  -- successful mark-paid, so it lands in the same click.
  IF new.status = 'paid' AND (TG_OP='INSERT' OR old.status <> 'paid') AND NOT new.is_reservation THEN
    BEGIN
      FOR v_ref IN SELECT id, tenant_id, earliest_month, expires_on
                     FROM hms_referral_rewards
                    WHERE matched_tenant_id = new.tenant_id AND status='held'
      LOOP
        -- Serialises two referred tenants qualifying for one referrer at the same
        -- instant, which would otherwise both pick the same month and have one
        -- silently swallowed by the handler.
        PERFORM pg_advisory_xact_lock(hashtextextended(v_ref.tenant_id::text, 0));
        v_month := hms_referral_next_open_month(
                     v_ref.tenant_id,
                     greatest(v_ref.earliest_month,
                              to_char((now() at time zone 'Asia/Karachi')::date,'YYYY-MM')),
                     v_ref.expires_on, v_ref.id);
        IF v_month IS NOT NULL THEN
          UPDATE hms_referral_rewards
             SET status='scheduled', for_month=v_month, qualified_at=now()
           WHERE id = v_ref.id AND status='held';
        END IF;
      END LOOP;
    EXCEPTION
      WHEN unique_violation THEN NULL;   -- expected collision; reconciler retries
      WHEN OTHERS THEN
        RAISE WARNING '[referral] job B failed for payment %: %', new.id, SQLERRM;
    END;
  END IF;

  RETURN NULL;
END;
$$;
revoke all on function public.hms_referral_on_payment_settled() from public, anon, authenticated;
grant execute on function public.hms_referral_on_payment_settled() to service_role;

drop trigger if exists hms_referral_settled_ins on public.hms_payments;
create trigger hms_referral_settled_ins after insert on public.hms_payments
  for each row when (new.status in ('paid','partially_paid','waived'))
  execute function public.hms_referral_on_payment_settled();

drop trigger if exists hms_referral_settled_upd on public.hms_payments;
create trigger hms_referral_settled_upd after update on public.hms_payments
  for each row when (new.status is distinct from old.status)
  execute function public.hms_referral_on_payment_settled();

-- ── 8. The reconciler ────────────────────────────────────────────────────────
create or replace function public.hms_referral_settle_rewards(p_hostel_id uuid, p_month text)
returns integer
language plpgsql security definer set search_path = public as $$
DECLARE v_enabled boolean; v_n integer := 0; w record; v_month text; v_paid boolean;
BEGIN
  SELECT referral_enabled INTO v_enabled FROM hms_hostels WHERE id = p_hostel_id;
  IF v_enabled IS NULL THEN RETURN 0; END IF;

  -- 0. DISABLING THE FEATURE IS A KILL SWITCH. Returning 0 here would leave every
  -- open reward discounting bills for up to four months while every owner-facing
  -- control refused to load. For the 14 branches that never enabled referrals
  -- this is one probe against an empty partial index.
  IF NOT v_enabled THEN
    FOR w IN SELECT id, tenant_id, for_month FROM hms_referral_rewards
              WHERE hostel_id = p_hostel_id AND status IN ('scheduled','held')
    LOOP
      UPDATE hms_referral_rewards
         SET status='void', voided_at=now(), void_reason='branch_disabled', for_month=NULL
       WHERE id = w.id;
      IF w.for_month IS NOT NULL THEN PERFORM hms_referral_touch_bill(w.tenant_id, w.for_month); END IF;
      v_n := v_n + 1;
    END LOOP;
    RETURN v_n;
  END IF;

  -- 1. Roll forward a scheduled reward whose month is gone.
  FOR w IN SELECT id, tenant_id, for_month, earliest_month, expires_on
             FROM hms_referral_rewards
            WHERE hostel_id = p_hostel_id AND status = 'scheduled' AND for_month < p_month
  LOOP
    IF hms_referral_month_occupied(w.tenant_id, w.for_month, w.id)
       OR NOT EXISTS (SELECT 1 FROM hms_payments p
                       WHERE p.tenant_id=w.tenant_id AND p.for_month=w.for_month) THEN
      v_month := hms_referral_next_open_month(w.tenant_id, p_month, w.expires_on, w.id);
      IF v_month IS NULL THEN
        UPDATE hms_referral_rewards SET status='expired', expired_at=now(),
               void_reason='no_open_month', for_month=NULL WHERE id=w.id;
      ELSE
        UPDATE hms_referral_rewards SET for_month=v_month WHERE id=w.id;
        PERFORM hms_referral_touch_bill(w.tenant_id, v_month);
      END IF;
      v_n := v_n + 1;
    END IF;
  END LOOP;

  -- 2. Self-heal a held reward whose release event was lost to a collision,
  --    BEFORE considering it for expiry.
  FOR w IN SELECT id, tenant_id, matched_tenant_id, earliest_month, expires_on
             FROM hms_referral_rewards
            WHERE hostel_id = p_hostel_id AND status = 'held'
  LOOP
    SELECT EXISTS (SELECT 1 FROM hms_payments p
                    WHERE p.tenant_id = w.matched_tenant_id
                      AND NOT p.is_reservation AND p.status='paid') INTO v_paid;
    IF v_paid THEN
      PERFORM pg_advisory_xact_lock(hashtextextended(w.tenant_id::text, 0));
      v_month := hms_referral_next_open_month(
                   w.tenant_id, greatest(w.earliest_month, p_month), w.expires_on, w.id);
      IF v_month IS NOT NULL THEN
        UPDATE hms_referral_rewards SET status='scheduled', for_month=v_month, qualified_at=now()
         WHERE id=w.id AND status='held';
        PERFORM hms_referral_touch_bill(w.tenant_id, v_month);
        v_n := v_n + 1;
      END IF;
    END IF;
  END LOOP;

  -- 3. Expire. EVERY expiry touches its bill so the ledger and the bill can never
  --    be observably out of step. Check-out expiry is scoped to months AFTER the
  --    beneficiary's final billed month, so the final month's reward survives and
  --    scales down with the pro-rated rent.
  -- Alias is rw, not w: w is the loop record variable, and PL/pgSQL resolves a
  -- bare w.tenant_id against the variable first, which is an ambiguity error.
  FOR w IN SELECT rw.id, rw.tenant_id, rw.for_month
             FROM hms_referral_rewards rw
             JOIN hms_tenants t ON t.id = rw.tenant_id
            WHERE rw.hostel_id = p_hostel_id AND rw.status IN ('scheduled','held')
              AND ( (now() at time zone 'Asia/Karachi')::date > rw.expires_on
                 OR (t.check_out IS NOT NULL
                     AND (rw.for_month IS NULL OR rw.for_month > to_char(t.check_out,'YYYY-MM'))) )
  LOOP
    UPDATE hms_referral_rewards
       SET status='expired', expired_at=now(),
           void_reason=coalesce(void_reason,'expired'), for_month=NULL WHERE id=w.id;
    IF w.for_month IS NOT NULL THEN PERFORM hms_referral_touch_bill(w.tenant_id, w.for_month); END IF;
    v_n := v_n + 1;
  END LOOP;

  -- 4. Attach: a reward granted after its bill already existed.
  FOR w IN SELECT rw.tenant_id, rw.for_month
             FROM hms_referral_rewards rw
             JOIN hms_payments p ON p.tenant_id=rw.tenant_id AND p.for_month=rw.for_month
            WHERE rw.hostel_id=p_hostel_id AND rw.status='scheduled'
              AND p.status IN ('pending','overdue') AND p.referral_percent = 0
  LOOP
    PERFORM hms_referral_touch_bill(w.tenant_id, w.for_month);
    v_n := v_n + 1;
  END LOOP;

  RETURN v_n;
END;
$$;
revoke all on function public.hms_referral_settle_rewards(uuid, text) from public, anon, authenticated;
grant execute on function public.hms_referral_settle_rewards(uuid, text) to service_role;

-- ── 9. hms_submit_referral v2 ────────────────────────────────────────────────
-- Migration 177's body, changed in exactly three places:
--   (a) the resolver SELECT's INTO list gains the two percentages — the
--       JOIN hms_hostels is ALREADY there, so zero extra queries on the
--       anonymous path;
--   (b) after the referrer cap, refuse a phone that is already a resident of
--       this owner. Without it, Waiting -> Active is a repeatable admission
--       event for an already-resident phone and the reward ceiling stops
--       meaning anything, because referrals are free to create;
--   (c) the INSERT gains promised_referrer_percent / promised_referred_percent,
--       snapshotting what the public page actually promised this visitor.
create or replace function public.hms_submit_referral(
  p_code text, p_name text, p_phone text, p_phone_digits text, p_ip text,
  p_max_pending integer, p_ip_link_hourly_limit integer,
  p_ip_hourly_limit integer, p_hostel_hourly_limit integer
) returns text
language plpgsql security definer set search_path = public as $$
DECLARE
  v_code_id     uuid;
  v_tenant_id   uuid;
  v_hostel_id   uuid;
  v_owner_id    uuid;
  v_referrer_pc smallint;
  v_referred_pc smallint;
  v_ip          text := coalesce(nullif(btrim(coalesce(p_ip, '')), ''), 'unknown');
  v_pending     integer;
BEGIN
  -- Charged BEFORE resolution: an invalid code is exactly what an attacker
  -- sends, and it must not be the one request that costs nothing.
  IF NOT public.hms_referral_rate_hit('ip:' || v_ip, p_ip_hourly_limit) THEN
    RETURN 'ip_limit';
  END IF;

  SELECT c.id, c.tenant_id, c.hostel_id, h.owner_id,
         h.referral_referrer_percent, h.referral_referred_percent
    INTO v_code_id, v_tenant_id, v_hostel_id, v_owner_id,
         v_referrer_pc, v_referred_pc
    FROM hms_referral_codes c
    JOIN hms_tenants t ON t.id = c.tenant_id
    JOIN hms_hostels h ON h.id = c.hostel_id
   WHERE lower(c.code) = lower(p_code)
     AND c.is_active
     AND t.is_active
     AND coalesce(t.is_waiting, false) = false
     AND h.referral_enabled;

  IF NOT FOUND THEN
    RETURN 'dead_link';
  END IF;

  IF NOT public.hms_referral_rate_hit('link:' || v_code_id::text || '|ip:' || v_ip,
                                      p_ip_link_hourly_limit) THEN
    RETURN 'ip_link_limit';
  END IF;

  IF NOT public.hms_referral_rate_hit('hostel:' || v_hostel_id::text,
                                      p_hostel_hourly_limit) THEN
    RETURN 'hostel_limit';
  END IF;

  PERFORM 1 FROM hms_referral_codes WHERE id = v_code_id FOR UPDATE;

  SELECT count(*) INTO v_pending
    FROM hms_referrals
   WHERE referrer_tenant_id = v_tenant_id
     AND status = 'pending'
     AND created_at >= now() - interval '14 days';

  IF v_pending >= p_max_pending THEN
    RETURN 'referrer_cap';
  END IF;

  IF EXISTS (SELECT 1 FROM hms_tenants t
               JOIN hms_hostels h2 ON h2.id = t.hostel_id
              WHERE h2.owner_id = v_owner_id
                AND t.phone_digits = p_phone_digits
                AND t.is_active
                AND NOT coalesce(t.is_waiting, false)) THEN
    RETURN 'already_resident';
  END IF;

  BEGIN
    INSERT INTO hms_referrals (
      code_id, referrer_tenant_id, hostel_id, owner_id,
      name, phone, phone_digits, ip_address,
      promised_referrer_percent, promised_referred_percent
    ) VALUES (
      v_code_id, v_tenant_id, v_hostel_id, v_owner_id,
      p_name, p_phone, p_phone_digits, nullif(v_ip, 'unknown'),
      coalesce(v_referrer_pc, 0), coalesce(v_referred_pc, 0)
    );
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO hms_referral_duplicate_claims (
      code_id, referrer_tenant_id, hostel_id, owner_id, name, phone, phone_digits
    ) VALUES (
      v_code_id, v_tenant_id, v_hostel_id, v_owner_id, p_name, p_phone, p_phone_digits
    );
    RETURN 'duplicate';
  END;

  RETURN 'ok';
END;
$$;
revoke all on function public.hms_submit_referral(text, text, text, text, text, integer, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.hms_submit_referral(text, text, text, text, text, integer, integer, integer, integer) to service_role;

-- ── 10. hms_attribute_referral v2 ────────────────────────────────────────────
create or replace function public.hms_attribute_referral(
  p_tenant_id uuid, p_hostel_id uuid, p_phone_digits text,
  p_check_in date, p_ttl_days integer
) returns boolean
language plpgsql security definer set search_path = public as $$
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

  v_referral_id := hms_referral_find_pending(v_owner_id, p_phone_digits, v_admitted, p_ttl_days);
  IF v_referral_id IS NULL THEN RETURN false; END IF;

  SELECT r.referrer_tenant_id, t.phone_digits INTO v_ref_tenant, v_ref_digits
    FROM hms_referrals r JOIN hms_tenants t ON t.id = r.referrer_tenant_id
   WHERE r.id = v_referral_id;

  -- GUARDS RUN BEFORE THE CONSUMING UPDATE. Rejected, not left pending, so the
  -- next admission does not retry them and the owner sees them on Marketing.
  --
  -- Keyed on PHONE, not tenant_id: one human is one row PER BRANCH, referral
  -- scope is the OWNER, and a re-admission mints a fresh uuid.
  IF p_tenant_id = v_ref_tenant
     OR (v_ref_digits IS NOT NULL AND v_ref_digits = p_phone_digits) THEN
    UPDATE hms_referrals SET status='rejected', rejected_at=now(),
           rewards_skipped_reason='self_referral' WHERE id = v_referral_id;
    RETURN false;
  END IF;

  -- Lifetime anti-recycling. Indexed by hms_referrals_owner_phone_joined_idx.
  IF EXISTS (SELECT 1 FROM hms_referrals x
              WHERE x.owner_id=v_owner_id AND x.phone_digits=p_phone_digits
                AND x.status='joined' AND x.id <> v_referral_id) THEN
    UPDATE hms_referrals SET status='rejected', rejected_at=now(),
           rewards_skipped_reason='already_referred' WHERE id = v_referral_id;
    RETURN false;
  END IF;

  -- Rolling cap: any future hole is bounded rather than unbounded.
  IF (SELECT count(*) FROM hms_referral_rewards w
       WHERE w.tenant_id = v_ref_tenant AND w.role='referrer'
         AND w.status <> 'void' AND w.created_at > now() - interval '90 days') >= 6 THEN
    UPDATE hms_referrals SET rewards_skipped_reason='referrer_cap_90d' WHERE id = v_referral_id;
  END IF;

  UPDATE hms_referrals
     SET status='joined', matched_tenant_id=p_tenant_id, matched_at=v_admitted
   WHERE id = v_referral_id AND status = 'pending';

  -- Captured before PERFORM, which resets FOUND.
  v_claimed := FOUND;
  IF v_claimed THEN PERFORM hms_grant_referral_rewards(v_referral_id); END IF;
  RETURN v_claimed;
END;
$$;
revoke all on function public.hms_attribute_referral(uuid, uuid, text, date, integer) from public, anon, authenticated;
grant execute on function public.hms_attribute_referral(uuid, uuid, text, date, integer) to service_role;
