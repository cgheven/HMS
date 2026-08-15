-- A pending referral goes stale after two weeks.
--
-- The window is a DEADLINE, not an attribution rule. An empty seat costs the
-- owner rent this month, so the referrer needs a reason to push now rather than
-- eventually. Tenant turnover reinforces it: over a longer window the referrer
-- may well have checked out before their own referral matured, at which point
-- their link is dead and the claim is moot anyway.
--
-- Only ONE thing changes in the database: the per-referrer pending cap now
-- counts recent rows only, so a tenant whose old submissions went stale gets
-- their budget back instead of being locked out by 25 dead rows.
--
-- Everything else is a READ-TIME derivation in app code — a stale row is
-- presented as expired and dropped from match suggestions without its status
-- column ever being rewritten. No cron, nothing to fail silently at 4am, and
-- changing the number later needs no backfill. It also keeps
-- getReferralOverview genuinely read-only, which was a security fix: an
-- unattended write driven by anonymous submissions is what let a stranger steer
-- attribution.
--
-- Consequence worth stating plainly: because the status column still says
-- 'pending', the partial unique index (owner_id, phone_digits) WHERE
-- status='pending' still holds for stale rows. That is deliberate. If it were
-- released, the same number could be re-submitted through a different tenant's
-- link and silently reassign a referral the first tenant had already earned.
-- The first submission keeps the claim; the deadline governs whether it pays.

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

  IF NOT public.hms_referral_rate_hit('ip:' || v_ip, p_ip_hourly_limit) THEN
    RETURN 'ip_limit';
  END IF;

  IF NOT public.hms_referral_rate_hit('hostel:' || v_hostel_id::text,
                                      p_hostel_hourly_limit) THEN
    RETURN 'hostel_limit';
  END IF;

  PERFORM 1 FROM hms_referral_codes WHERE id = v_code_id FOR UPDATE;

  -- The only change from 174: stale rows no longer consume the budget. Without
  -- the interval, a tenant who collected 25 submissions that never converted
  -- could never be referred through again.
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
