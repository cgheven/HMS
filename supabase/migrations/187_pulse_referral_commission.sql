-- Pulse's commission on a converted referral.
--
-- THE MODEL: when a referral joins, the referrer gets a discount, the new tenant
-- gets a discount, and Pulse charges a ONE-TIME commission of N% of that
-- tenant's first month rent. N is 15 by default, set platform-wide by Super
-- Admin, and overridable per branch so a client can be given relief.
--
-- Additive and inert until somebody sets a percentage: the platform rate is
-- SEEDED AT 0, hms_referrals gains columns that stay NULL on all existing rows,
-- and no existing query changes. Nothing is charged until Super Admin sets a rate.

-- ─────────────────────────────────────────────────────────────────────────────
-- A. The platform-wide default
-- ─────────────────────────────────────────────────────────────────────────────
-- Single-row by construction: the primary key is a boolean CHECKed to true, so
-- a second row is a constraint violation rather than a silent second source of
-- truth that half the code reads and the other half does not.
create table if not exists public.hms_platform_settings (
  id                          boolean primary key default true check (id),
  referral_commission_percent smallint not null default 15
    check (referral_commission_percent between 0 and 100),
  updated_at                  timestamptz not null default now()
);

-- Seeded at 0, NOT at the column default of 15. Applying this migration must
-- not start billing 16 live clients the moment it runs; the rate goes live only
-- when Super Admin deliberately sets it. The column default stays 15 so the
-- Super Admin dialog still opens at the intended figure.
insert into public.hms_platform_settings (id, referral_commission_percent)
values (true, 0)
on conflict (id) do nothing;

alter table public.hms_platform_settings enable row level security;
revoke all on public.hms_platform_settings from anon, authenticated;

drop trigger if exists hms_platform_settings_updated_at on public.hms_platform_settings;
create trigger hms_platform_settings_updated_at before update
  on public.hms_platform_settings for each row
  execute function public.hms_set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- B. The per-branch override
-- ─────────────────────────────────────────────────────────────────────────────
-- NULL means "use the platform default", which is different from 0 ("this
-- branch is charged nothing"). Collapsing the two would make relief
-- indistinguishable from never having been configured, and a later change to
-- the platform rate would silently start billing a client who was given a
-- permanent exemption.
alter table public.hms_hostels
  add column if not exists pulse_commission_percent smallint;

alter table public.hms_hostels
  drop constraint if exists hms_hostels_pulse_commission_range;
alter table public.hms_hostels
  add constraint hms_hostels_pulse_commission_range
  check (pulse_commission_percent is null
      or pulse_commission_percent between 0 and 100);

-- ─────────────────────────────────────────────────────────────────────────────
-- C. What was charged, snapshotted per referral
-- ─────────────────────────────────────────────────────────────────────────────
-- Both NULL on every existing row, and written once at grant time. Snapshotted
-- rather than re-derived because the rate is editable and the tenant's rent
-- moves: a commission already charged must not change when either does.
alter table public.hms_referrals
  add column if not exists pulse_commission_percent smallint,
  add column if not exists pulse_commission_amount  numeric(10,2),
  -- When the fee was actually charged. The reporting month buckets on THIS, not
  -- on when the referral was submitted: a link shared in July that converts in
  -- August is August's revenue for Pulse, and filing it under July would put a
  -- charge in a month that had already been reported on.
  add column if not exists pulse_commission_charged_at  timestamptz,
  -- Reversed, never nulled. Rejecting a referral refunds every rupee on the
  -- owner's side, and it has to refund Pulse's too — otherwise the platform
  -- keeps 15% of a conversion the owner just declared invalid. Keeping the
  -- original amount beside the reversal is the audit trail.
  add column if not exists pulse_commission_reversed_at timestamptz;

alter table public.hms_referrals
  drop constraint if exists hms_referrals_pulse_commission_valid;
alter table public.hms_referrals
  add constraint hms_referrals_pulse_commission_valid
  check ((pulse_commission_percent is null or pulse_commission_percent between 0 and 100)
     and (pulse_commission_amount is null or pulse_commission_amount >= 0));

-- ─────────────────────────────────────────────────────────────────────────────
-- D. Owners may not set their own commission
-- ─────────────────────────────────────────────────────────────────────────────
-- Same reasoning as referral_enabled and the two discount percentages: migration
-- 094 grants a tier='full' partner UPDATE on hms_hostels, and this column is
-- Pulse's revenue. Extends the existing guard rather than adding a second one.
create or replace function public.hms_prevent_referral_self_grant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.referral_enabled AND auth.uid() IS NOT NULL THEN
      RAISE EXCEPTION 'Forbidden: referral_enabled can only be set by Super Admin';
    END IF;
    IF (coalesce(NEW.referral_referrer_percent, 0) <> 0
     OR coalesce(NEW.referral_referred_percent, 0) <> 0)
     AND auth.uid() IS NOT NULL THEN
      RAISE EXCEPTION 'Forbidden: referral percentages are set through the Marketing page, not directly';
    END IF;
    IF NEW.pulse_commission_percent IS NOT NULL AND auth.uid() IS NOT NULL THEN
      RAISE EXCEPTION 'Forbidden: the Pulse commission can only be set by Super Admin';
    END IF;
  ELSE
    IF NEW.referral_enabled IS DISTINCT FROM OLD.referral_enabled AND auth.uid() IS NOT NULL THEN
      RAISE EXCEPTION 'Forbidden: referral_enabled can only be changed by Super Admin';
    END IF;
    IF (NEW.referral_referrer_percent IS DISTINCT FROM OLD.referral_referrer_percent
     OR NEW.referral_referred_percent IS DISTINCT FROM OLD.referral_referred_percent)
     AND auth.uid() IS NOT NULL THEN
      RAISE EXCEPTION 'Forbidden: referral percentages are set through the Marketing page, not directly';
    END IF;
    IF NEW.pulse_commission_percent IS DISTINCT FROM OLD.pulse_commission_percent
     AND auth.uid() IS NOT NULL THEN
      RAISE EXCEPTION 'Forbidden: the Pulse commission can only be changed by Super Admin';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- E. Charge it at grant time
-- ─────────────────────────────────────────────────────────────────────────────
-- The effective rate for one branch: its own override, or the platform default.
create or replace function public.hms_pulse_commission_percent(p_hostel_id uuid)
returns smallint
language sql stable security definer set search_path = public as $$
  SELECT coalesce(
    (SELECT h.pulse_commission_percent FROM hms_hostels h WHERE h.id = p_hostel_id),
    (SELECT s.referral_commission_percent FROM hms_platform_settings s WHERE s.id),
    0
  )::smallint;
$$;
revoke all on function public.hms_pulse_commission_percent(uuid) from public, anon, authenticated;
grant execute on function public.hms_pulse_commission_percent(uuid) to service_role;

-- Stamps the commission onto a referral the first time it is granted.
--
-- Base is the referred tenant's monthly_rent as it stands at admission — the
-- "first month rent" the fee is quoted against. A daily-billed tenant carries
-- monthly_rent = 0 and therefore no commission, which is correct: there is no
-- first month to take a percentage of.
--
-- Guarded on pulse_commission_amount IS NULL so a re-grant (waiting -> active
-- -> waiting -> active) can never charge the same client twice for one referral.
create or replace function public.hms_charge_pulse_commission(p_referral_id uuid)
returns numeric
language plpgsql security definer set search_path = public as $$
DECLARE
  v_hostel  uuid;
  v_rent    numeric(10,2);
  v_waiting boolean;
  v_pct     smallint;
  v_amount  numeric(10,2);
BEGIN
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
  -- 0.00 is not NULL, and the IS NULL guard above is what makes this function
  -- idempotent — so writing 0 because the rent is not known YET freezes the fee
  -- at nothing, permanently, with no code path able to recover it.
  --
  -- This is the ordinary case, not an edge case: a referred person arrives
  -- before a bed is free, goes on the waiting list (which clears room_id, so the
  -- rent never auto-fills and Save does not require one), pays a seat deposit
  -- that fires attribution, and moves into a real room two weeks later. Both
  -- discounts are re-derived off the real rent at bill time by migration 186;
  -- only this fee would have been stranded at zero.
  --
  -- Staying NULL means "not priced yet" and lets the re-charge trigger below
  -- settle it the moment a real rent exists.
  IF v_waiting OR v_rent <= 0 THEN RETURN 0; END IF;

  v_pct := hms_pulse_commission_percent(v_hostel);
  v_amount := round(v_rent * v_pct / 100.0, 2);

  UPDATE hms_referrals
     SET pulse_commission_percent    = v_pct,
         pulse_commission_amount     = v_amount,
         pulse_commission_charged_at = now()
   WHERE id = p_referral_id;

  RETURN v_amount;
END;
$$;
revoke all on function public.hms_charge_pulse_commission(uuid) from public, anon, authenticated;
grant execute on function public.hms_charge_pulse_commission(uuid) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- F. Hook it onto the one place a referral becomes 'joined'
-- ─────────────────────────────────────────────────────────────────────────────
-- hms_attribute_referral is the single writer of the pending -> joined
-- transition, and it already calls hms_grant_referral_rewards there. The
-- commission is charged on the same event and in the same transaction, so a
-- referral can never be converted without being billed, or billed without
-- having converted.
--
-- Body is migration 185's, changed in exactly one place: the PERFORM below.
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

  IF p_tenant_id = v_ref_tenant
     OR (v_ref_digits IS NOT NULL AND v_ref_digits = p_phone_digits) THEN
    UPDATE hms_referrals SET status='rejected', rejected_at=now(),
           rewards_skipped_reason='self_referral' WHERE id = v_referral_id;
    RETURN false;
  END IF;

  -- matched_tenant_id, not status='joined': it is written ONLY by this function,
  -- so it means "this phone has already been converted once" regardless of any
  -- later status edit. Keyed on status, the sequence reject -> back to waiting ->
  -- new submission -> reactivate charges the same admission a second time.
  IF EXISTS (SELECT 1 FROM hms_referrals x
              WHERE x.owner_id=v_owner_id AND x.phone_digits=p_phone_digits
                AND x.matched_tenant_id IS NOT NULL AND x.id <> v_referral_id) THEN
    UPDATE hms_referrals SET status='rejected', rejected_at=now(),
           rewards_skipped_reason='already_referred' WHERE id = v_referral_id;
    RETURN false;
  END IF;

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
    -- their 90-day cap, grants zero rewards — and billing the owner 15% for a
    -- programme that gave nobody anything is a fee for nothing. The re-charge
    -- trigger picks it up later if the rent was simply not known yet.
    IF hms_grant_referral_rewards(v_referral_id) > 0 THEN
      PERFORM hms_charge_pulse_commission(v_referral_id);
    END IF;
  END IF;
  RETURN v_claimed;
END;
$$;
revoke all on function public.hms_attribute_referral(uuid, uuid, text, date, integer) from public, anon, authenticated;
grant execute on function public.hms_attribute_referral(uuid, uuid, text, date, integer) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- G. Settle the fee once a real rent exists
-- ─────────────────────────────────────────────────────────────────────────────
-- The companion to the "leave it NULL" rule above. A referral converted while
-- the tenant was unpriced stays unpriced until this fires — on the rent being
-- set, or on the waiting-list flag clearing.
--
-- Deliberately a DB trigger rather than a call from the three UI activation
-- sites: those cover activation but not a plain rent edit, and they miss the
-- reservation-then-activate path entirely when the owner corrects the rent
-- without touching the status toggle.
--
-- The "never re-derive" contract survives intact: hms_charge_pulse_commission
-- still refuses any referral whose amount is already stamped.
--
-- For the 14 branches that never enable referrals this is one indexed probe
-- against a table that is empty for them.
create or replace function public.hms_recharge_pulse_commission_on_rent()
returns trigger language plpgsql security definer set search_path = public as $$
DECLARE r record;
BEGIN
  IF (new.monthly_rent IS DISTINCT FROM old.monthly_rent
      OR (coalesce(old.is_waiting, false) AND NOT coalesce(new.is_waiting, false)))
     AND coalesce(new.monthly_rent, 0) > 0
     AND NOT coalesce(new.is_waiting, false) THEN
    FOR r IN SELECT rf.id FROM hms_referrals rf
              WHERE rf.matched_tenant_id = new.id
                AND rf.status = 'joined'
                AND rf.pulse_commission_amount IS NULL
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

drop trigger if exists hms_recharge_pulse_commission on public.hms_tenants;
create trigger hms_recharge_pulse_commission
  after update of monthly_rent, is_waiting on public.hms_tenants
  for each row execute function public.hms_recharge_pulse_commission_on_rent();

-- ─────────────────────────────────────────────────────────────────────────────
-- H. Reversal
-- ─────────────────────────────────────────────────────────────────────────────
-- Rejecting a referral voids both discounts on the owner's side. It has to void
-- Pulse's fee too, or the platform keeps 15% of a conversion the owner has just
-- declared invalid — and note the asymmetry that makes the alternative
-- indefensible: fraud the DATABASE catches (self_referral, already_referred)
-- returns before the fee is charged and costs the client nothing, while fraud a
-- HUMAN catches would cost them 15%.
--
-- Stamped, not nulled: the amount stays beside the reversal so there is a record
-- of what was charged and unwound.
create or replace function public.hms_reverse_pulse_commission(p_referral_id uuid, p_reason text)
returns numeric
language plpgsql security definer set search_path = public as $$
DECLARE v_amount numeric(10,2);
BEGIN
  UPDATE hms_referrals
     SET pulse_commission_reversed_at = now()
   WHERE id = p_referral_id
     AND pulse_commission_amount IS NOT NULL
     AND pulse_commission_reversed_at IS NULL
  RETURNING pulse_commission_amount INTO v_amount;
  RETURN coalesce(v_amount, 0);
END;
$$;
revoke all on function public.hms_reverse_pulse_commission(uuid, text) from public, anon, authenticated;
grant execute on function public.hms_reverse_pulse_commission(uuid, text) to service_role;

-- Un-rejecting restores the owner's discounts, so it restores the fee too. Safe
-- because the charge is idempotent on IS NULL — a referral whose amount survived
-- the reversal simply becomes chargeable again rather than being charged twice.
create or replace function public.hms_unreverse_pulse_commission(p_referral_id uuid)
returns void
language sql security definer set search_path = public as $$
  UPDATE hms_referrals SET pulse_commission_reversed_at = NULL
   WHERE id = p_referral_id AND pulse_commission_reversed_at IS NOT NULL;
$$;
revoke all on function public.hms_unreverse_pulse_commission(uuid) from public, anon, authenticated;
grant execute on function public.hms_unreverse_pulse_commission(uuid) to service_role;
