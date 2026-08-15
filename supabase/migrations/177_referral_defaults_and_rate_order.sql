-- Two corrections found in review. Supersedes decisions made in 175 and 176;
-- neither of those is edited, because both are already applied to production and
-- rewriting an applied migration hides the history of why this changed.

-- ── A. Percentages must start at 0, not 10 ──────────────────────────────────
-- 175 defaulted both to 10 on the reasoning that 10 is the intended headline
-- number. That was wrong: the moment Super Admin enables a branch, its public
-- /ref pages begin promising strangers 10% off before the owner has agreed to
-- anything. The owner is then bound by an offer they never made.
--
-- 0 is already the documented "no offer" state — the public page drops its
-- headline and the WhatsApp draft omits that side entirely — so a branch enabled
-- before its owner picks a number now advertises nothing at all.
--
-- The UPDATE is the point. Changing only the DEFAULT fixes nothing: 175 is
-- applied, so all 15 existing rows already hold 10/10 and would keep promising
-- 10%. Guarded on both columns still being at the untouched default so that any
-- owner who has already chosen a number keeps it.
alter table public.hms_hostels
  alter column referral_referrer_percent set default 0,
  alter column referral_referred_percent set default 0;

update public.hms_hostels
   set referral_referrer_percent = 0,
       referral_referred_percent = 0
 where referral_referrer_percent = 10
   and referral_referred_percent = 10;

-- ── C. An unresolvable code must still cost the caller ──────────────────────
-- 176 resolved the code first and returned 'dead_link' before touching any rate
-- bucket, so a caller hammering invalid codes paid nothing and left no row in
-- hms_referral_rate_window — unauthenticated, unmetered, untraceable service-role
-- load on the same database 16 clients depend on.
--
-- The per-IP bucket moves ABOVE resolution so every attempt is charged. The
-- per-link and per-branch buckets stay below it because they need v_code_id and
-- v_hostel_id, which do not exist until the code resolves.
--
-- Lock ordering is unchanged (ip -> link -> hostel -> code row FOR UPDATE), so
-- no new deadlock cycle is introduced.
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
  -- Charged BEFORE resolution: an invalid code is exactly what an attacker
  -- sends, and it must not be the one request that costs nothing.
  IF NOT public.hms_referral_rate_hit('ip:' || v_ip, p_ip_hourly_limit) THEN
    RETURN 'ip_limit';
  END IF;

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

revoke all on function public.hms_submit_referral(text, text, text, text, text, integer, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.hms_submit_referral(text, text, text, text, text, integer, integer, integer, integer)
  to service_role;
