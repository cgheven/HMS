-- Referral abuse controls. Follow-up to 173, still phase 1: no money, no
-- commission, no change to hms_payments or to any tenant-creation path.
--
-- 173 shipped the two abuse caps (per-IP volume, 25 pending per referrer) in
-- application code as COUNT-then-INSERT. Both are check-then-act with nothing
-- atomic behind them: a burst of concurrent submissions all read the same
-- pre-burst count and all insert. The only DB-enforced rule was the pending
-- uniqueness index, which bounds duplicate phones, not volume. Everything here
-- exists to move those ceilings into the database, where a concurrent burst
-- cannot step over them.
--
-- NOTHING IN 173 IS ALTERED. This file only adds tables and functions.

-- ── Atomic rate windows ──────────────────────────────────────────────────────
-- One row per (bucket, hour). The counter is incremented by the same statement
-- that reads it, so N concurrent callers get N distinct values back and the
-- (N+1)th is refused no matter how they interleave.
create table if not exists public.hms_referral_rate_window (
  bucket       text        not null,
  window_start timestamptz not null,
  n            integer     not null default 0,
  primary key (bucket, window_start)
);

-- Windows are disposable; nothing reads them after their hour has passed.
create index if not exists hms_referral_rate_window_start_idx
  on public.hms_referral_rate_window (window_start);

-- ── Duplicate claims ────────────────────────────────────────────────────────
-- "First submission wins" is enforced by the unique index in 173, and the loser
-- of that race was previously told "success" and then forgotten. That is how a
-- genuine referrer's submission disappears with no trace for anyone to
-- adjudicate — and, since whoever submits a number first owns the eventual
-- attribution, how a stranger can pre-emptively claim numbers. The losing
-- submission is recorded here so the owner can see the collision.
create table if not exists public.hms_referral_duplicate_claims (
  id                 uuid primary key default gen_random_uuid(),
  code_id            uuid not null references public.hms_referral_codes(id) on delete cascade,
  referrer_tenant_id uuid not null references public.hms_tenants(id) on delete cascade,
  hostel_id          uuid not null references public.hms_hostels(id) on delete cascade,
  owner_id           uuid not null references auth.users(id) on delete cascade,
  name               text not null,
  phone              text not null,
  phone_digits       text not null,
  created_at         timestamptz not null default now()
);

create index if not exists hms_referral_duplicate_claims_hostel_idx
  on public.hms_referral_duplicate_claims (hostel_id, created_at desc);

-- ── Atomic bucket increment ─────────────────────────────────────────────────
-- Returns true when the caller is inside the ceiling. Always increments first:
-- a refused caller still pays for the attempt, otherwise the limit resets for
-- anyone willing to keep hammering it.
create or replace function public.hms_referral_rate_hit(
  p_bucket text,
  p_limit  integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
DECLARE
  v_n integer;
BEGIN
  INSERT INTO hms_referral_rate_window (bucket, window_start, n)
  VALUES (p_bucket, date_trunc('hour', now()), 1)
  ON CONFLICT (bucket, window_start)
    DO UPDATE SET n = hms_referral_rate_window.n + 1
  RETURNING n INTO v_n;

  RETURN v_n <= p_limit;
END;
$$;

-- ── The one write the public form is allowed to make ────────────────────────
-- Resolution, every abuse ceiling and the insert happen in ONE transaction, and
-- concurrent submissions against the same link serialize on that link's row.
-- Without the FOR UPDATE, two thousand parallel requests each count 0 pending
-- and each insert.
--
-- Returns a reason string rather than raising: the caller answers the public
-- form identically for every refusal, and an exception would cost a log line
-- carrying the referred person's phone.
--   'ok' | 'dead_link' | 'ip_link_limit' | 'ip_limit' | 'hostel_limit'
--   | 'referrer_cap' | 'duplicate'
create or replace function public.hms_submit_referral(
  p_code                 text,
  p_name                 text,
  p_phone                text,
  p_phone_digits         text,
  p_ip                   text,
  p_max_pending          integer,
  p_ip_link_hourly_limit integer,
  p_ip_hourly_limit      integer,
  p_hostel_hourly_limit  integer
) returns text
language plpgsql
security definer
set search_path = public
as $$
DECLARE
  v_code_id   uuid;
  v_tenant_id uuid;
  v_hostel_id uuid;
  v_owner_id  uuid;
  v_ip        text := coalesce(nullif(btrim(coalesce(p_ip, '')), ''), 'unknown');
  v_pending   integer;
BEGIN
  -- Resolve first so the per-link bucket can be keyed on the code: many people
  -- behind one branch WiFi or one carrier NAT share an IP, and a flat per-IP
  -- ceiling would silently drop the second half of a referral push.
  --
  -- is_waiting is part of the house definition of an active tenant: a
  -- waiting-list row can carry is_active = true while the person has never
  -- moved in, and they are not a resident who may hand out a link.
  SELECT c.id, c.tenant_id, c.hostel_id, h.owner_id
    INTO v_code_id, v_tenant_id, v_hostel_id, v_owner_id
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

  -- A missing IP header lands every such caller in the shared 'unknown' bucket
  -- rather than exempting them: an unidentifiable caller must not be the one
  -- caller with no ceiling.
  IF NOT public.hms_referral_rate_hit('ip:' || v_ip, p_ip_hourly_limit) THEN
    RETURN 'ip_limit';
  END IF;

  -- The per-referrer cap bounds one link; this bounds the branch, which is what
  -- an attacker spreading a burst across many links would otherwise escape.
  IF NOT public.hms_referral_rate_hit('hostel:' || v_hostel_id::text,
                                      p_hostel_hourly_limit) THEN
    RETURN 'hostel_limit';
  END IF;

  PERFORM 1 FROM hms_referral_codes WHERE id = v_code_id FOR UPDATE;

  SELECT count(*) INTO v_pending
    FROM hms_referrals
   WHERE referrer_tenant_id = v_tenant_id
     AND status = 'pending';

  IF v_pending >= p_max_pending THEN
    RETURN 'referrer_cap';
  END IF;

  BEGIN
    INSERT INTO hms_referrals (
      code_id, referrer_tenant_id, hostel_id, owner_id,
      name, phone, phone_digits, ip_address
    ) VALUES (
      v_code_id, v_tenant_id, v_hostel_id, v_owner_id,
      p_name, p_phone, p_phone_digits, nullif(v_ip, 'unknown')
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

-- ── Access ──────────────────────────────────────────────────────────────────
-- Same posture as 173: RLS on, no policies, no grants. Both new tables are
-- reachable only by the service role.
alter table public.hms_referral_rate_window      enable row level security;
alter table public.hms_referral_duplicate_claims enable row level security;

revoke all on public.hms_referral_rate_window      from anon, authenticated;
revoke all on public.hms_referral_duplicate_claims from anon, authenticated;

-- Postgres grants EXECUTE on new functions to PUBLIC by default, and these are
-- SECURITY DEFINER — leaving that in place would hand the anon key a
-- rate-limit-bypassing insert oracle through PostgREST's /rpc.
revoke all on function public.hms_referral_rate_hit(text, integer)
  from public, anon, authenticated;
revoke all on function public.hms_submit_referral(text, text, text, text, text, integer, integer, integer, integer)
  from public, anon, authenticated;

grant execute on function public.hms_referral_rate_hit(text, integer)
  to service_role;
grant execute on function public.hms_submit_referral(text, text, text, text, text, integer, integer, integer, integer)
  to service_role;
