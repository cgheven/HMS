-- Pulse referral source, part 3: the public write path.
--
-- 194 gave hms_referral_codes a `source` and let tenant_id be NULL; 195 taught
-- the reward engine to pay a referral that has no referrer. Neither touched
-- hms_submit_referral, which still resolved a code by INNER JOINing the
-- referrer tenant — so every Pulse code answered 'dead_link' and the public
-- page offered a form that could never be submitted.
--
-- This migration closes that, and closes four abuse holes that only became
-- reachable once the link is deliberately published to strangers.

-- ── 1. hms_referral_rate_hit ────────────────────────────────────────────────
-- Three problems, all of them worse now that the entry point is public:
--
-- (a) EXECUTE had drifted back to anon/authenticated. The function is SECURITY
--     DEFINER over an arbitrary bucket string and an arbitrary limit, so the
--     anon key that ships in the browser bundle could increment ANY bucket
--     through PostgREST /rpc — including 'hostel:<uuid>', which silently
--     switches off a whole branch's funnel for the hour. Migration 174 revoked
--     this once already; it did not stick, so it is re-asserted here and must
--     be re-audited after every deploy.
-- (b) The counter was incremented BEFORE the ceiling was compared, so a caller
--     already over its limit still bought one write per request forever.
-- (c) No reaper. Migration 180 gave hms_auth_rate_window opportunistic pruning
--     and left this table, whose bucket column is a cleartext log of visitor
--     IPs, growing without bound. pg_cron is not installed on this project, so
--     the prune has to ride on the write path.
create or replace function public.hms_referral_rate_hit(p_bucket text, p_limit integer)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_n     integer;
  v_start timestamptz := date_trunc('hour', now());
BEGIN
  -- Opportunistic prune, same shape as migration 180. Bounded by LIMIT so no
  -- single unlucky request pays for the whole backlog.
  IF random() < 0.05 THEN
    DELETE FROM hms_referral_rate_window
     WHERE ctid IN (SELECT ctid FROM hms_referral_rate_window
                     WHERE window_start < v_start - interval '2 hours'
                     LIMIT 500);
  END IF;

  -- Read before write. Once a bucket is over its ceiling the answer cannot
  -- change until the hour rolls, so continuing to increment only hands an
  -- attacker a free, unbounded INSERT/UPDATE primitive.
  SELECT n INTO v_n
    FROM hms_referral_rate_window
   WHERE bucket = p_bucket AND window_start = v_start;
  IF v_n IS NOT NULL AND v_n >= p_limit THEN
    RETURN false;
  END IF;

  INSERT INTO hms_referral_rate_window (bucket, window_start, n)
  VALUES (p_bucket, v_start, 1)
  ON CONFLICT (bucket, window_start)
    DO UPDATE SET n = hms_referral_rate_window.n + 1
  RETURNING n INTO v_n;

  RETURN v_n <= p_limit;
END;
$function$;

delete from public.hms_referral_rate_window
 where window_start < date_trunc('hour', now()) - interval '2 hours';

-- ── 2. Rate limiters are server-side only ───────────────────────────────────
-- Both are SECURITY DEFINER and both take a caller-chosen bucket. Every real
-- caller is a service-role server action. Handing them to anon turns each into
-- a denial-of-service switch: hms_referral_rate_hit can mute a branch's whole
-- referral funnel, hms_auth_rate_hit can pre-exhaust 'pwreset:email:<victim>'
-- and lock a real person out of password recovery.
revoke all on function public.hms_referral_rate_hit(text, integer) from public, anon, authenticated;
revoke all on function public.hms_auth_rate_hit(text, integer) from public, anon, authenticated;
grant execute on function public.hms_referral_rate_hit(text, integer) to service_role;
grant execute on function public.hms_auth_rate_hit(text, integer) to service_role;

-- ── 3. hms_submit_referral ──────────────────────────────────────────────────
-- Signature gains two DEFAULTED parameters. The old nine-argument signature is
-- DROPPED rather than left in place: Postgres would otherwise keep both and a
-- nine-argument call would match each of them, failing as "function is not
-- unique". With the old one gone, the currently deployed app's nine-argument
-- call resolves to this body with the two defaults applied — which is what lets
-- the migration land BEFORE the deploy without a window where the public form
-- errors for every visitor.
drop function if exists public.hms_submit_referral(text,text,text,text,text,integer,integer,integer,integer);

create or replace function public.hms_submit_referral(
  p_code                       text,
  p_name                       text,
  p_phone                      text,
  p_phone_digits               text,
  p_ip                         text,
  p_max_pending                integer,
  p_ip_link_hourly_limit       integer,
  p_ip_hourly_limit            integer,
  p_hostel_hourly_limit        integer,
  p_pulse_max_pending          integer default 100,
  p_pulse_ip_link_hourly_limit integer default 200
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_code_id     uuid;
  v_tenant_id   uuid;
  v_hostel_id   uuid;
  v_owner_id    uuid;
  v_source      text;
  v_referrer_pc smallint;
  v_referred_pc smallint;
  v_ip          text := coalesce(nullif(btrim(coalesce(p_ip, '')), ''), 'unknown');
  v_pending     integer;
  v_is_pulse    boolean;
BEGIN
  -- Charged BEFORE resolution: an invalid code is exactly what an attacker
  -- sends, and it must not be the one request that costs nothing.
  IF NOT public.hms_referral_rate_hit('ip:' || v_ip, p_ip_hourly_limit) THEN
    RETURN 'ip_limit';
  END IF;

  -- LEFT JOIN, and the resident gate applied only to tenant codes: a Pulse code
  -- has tenant_id NULL and no resident behind it to check. Mirrors the narrowing
  -- in lib/referrals-server.ts:getReferralTarget so the page and this RPC agree
  -- about which codes are live.
  --
  -- Two gates added that the old body never had:
  --   referral_campaign <> 'paused' — pausing was enforced only on the page
  --     render, so a direct POST kept writing referrals the owner had explicitly
  --     decided not to honour. With a permanently public Pulse URL, pause is the
  --     owner's only off-switch short of disabling referrals entirely.
  --   a Pulse code on a branch discounting 0% is dead — there is no referrer to
  --     reward and nothing to promise the visitor, so advertising the link would
  --     be advertising nothing. A TENANT code at 0% is untouched: it can still
  --     pay the referrer side.
  -- Both fall through to the single NOT FOUND -> 'dead_link' return, so no new
  -- observable state is introduced and the endpoint stays a non-oracle.
  SELECT c.id, c.tenant_id, c.hostel_id, c.source, h.owner_id,
         h.referral_referrer_percent, h.referral_referred_percent
    INTO v_code_id, v_tenant_id, v_hostel_id, v_source, v_owner_id,
         v_referrer_pc, v_referred_pc
    FROM hms_referral_codes c
    LEFT JOIN hms_tenants t ON t.id = c.tenant_id
    JOIN hms_hostels h ON h.id = c.hostel_id
   WHERE lower(c.code) = lower(p_code)
     AND c.is_active
     AND h.referral_enabled
     AND coalesce(h.referral_campaign, 'off') <> 'paused'
     AND (c.source = 'pulse'
          OR (t.is_active AND coalesce(t.is_waiting, false) = false))
     AND (c.source <> 'pulse'
          OR coalesce(h.referral_referred_percent, 0) >= 1);

  IF NOT FOUND THEN
    RETURN 'dead_link';
  END IF;

  v_is_pulse := (v_source = 'pulse');

  -- A Pulse link is broadcast, not handed to one person, so the per-(link, IP)
  -- ceiling sized for a tenant's private link would refuse the eleventh genuine
  -- visitor behind a shared WiFi or carrier NAT — and that refusal is reported
  -- to the visitor as success, so the lead vanishes silently.
  IF NOT public.hms_referral_rate_hit('link:' || v_code_id::text || '|ip:' || v_ip,
                                      CASE WHEN v_is_pulse
                                           THEN p_pulse_ip_link_hourly_limit
                                           ELSE p_ip_link_hourly_limit END) THEN
    RETURN 'ip_link_limit';
  END IF;

  -- Separate buckets. Sharing one would let a stranger holding the published
  -- Pulse URL exhaust the branch's hourly allowance and silently kill every
  -- genuine TENANT referral at that branch for the rest of the hour.
  IF NOT public.hms_referral_rate_hit(
           CASE WHEN v_is_pulse THEN 'pulse:' ELSE 'hostel:' END || v_hostel_id::text,
           p_hostel_hourly_limit) THEN
    RETURN 'hostel_limit';
  END IF;

  PERFORM 1 FROM hms_referral_codes WHERE id = v_code_id FOR UPDATE;

  -- The per-referrer cap counts `referrer_tenant_id = v_tenant_id`. For a Pulse
  -- code v_tenant_id is NULL, `= NULL` is never true, and the cap silently
  -- becomes a no-op — leaving the hourly rate limit as the only ceiling on a
  -- link that is public by design. Pulse gets its own cap keyed on the code.
  IF v_is_pulse THEN
    SELECT count(*) INTO v_pending
      FROM hms_referrals
     WHERE code_id = v_code_id
       AND status = 'pending'
       AND created_at >= now() - interval '14 days';
    IF v_pending >= p_pulse_max_pending THEN
      RETURN 'referrer_cap';
    END IF;
  ELSE
    SELECT count(*) INTO v_pending
      FROM hms_referrals
     WHERE referrer_tenant_id = v_tenant_id
       AND status = 'pending'
       AND created_at >= now() - interval '14 days';
    IF v_pending >= p_max_pending THEN
      RETURN 'referrer_cap';
    END IF;
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
    -- `source` is passed explicitly on BOTH inserts rather than left to the
    -- column default. 194's shape CHECK is ((source='pulse') = (referrer is
    -- null)), so a Pulse row that inherits the 'tenant' default raises 23514 —
    -- and in the handler below that raise escapes the EXCEPTION block, turning
    -- the deliberate silent 'duplicate' success into a visible error. That
    -- difference would answer "is this number already referred / already a
    -- resident here?" for anyone holding the public link, which is the exact
    -- oracle this whole endpoint is built to avoid.
    --
    -- promised_referrer_percent is forced to 0 for Pulse: there is no referrer,
    -- and the stored amount is NET of every promised percent.
    INSERT INTO hms_referrals (
      code_id, referrer_tenant_id, hostel_id, owner_id,
      name, phone, phone_digits, ip_address,
      promised_referrer_percent, promised_referred_percent, source
    ) VALUES (
      v_code_id, v_tenant_id, v_hostel_id, v_owner_id,
      p_name, p_phone, p_phone_digits, nullif(v_ip, 'unknown'),
      CASE WHEN v_is_pulse THEN 0 ELSE coalesce(v_referrer_pc, 0) END,
      coalesce(v_referred_pc, 0), v_source
    );
  EXCEPTION WHEN unique_violation THEN
    -- Deduplicated. This table has no uniqueness of its own, so re-POSTing one
    -- number wrote one row per attempt — the only unbounded write left on the
    -- public path, and the cheapest one for a bot to drive now that the link is
    -- published. The owner's signal is "this lead was already claimed", which is
    -- one fact, not one fact per retry.
    --
    -- The return value is unchanged either way: whether a row was written must
    -- never be observable, or the endpoint becomes a "has this number already
    -- been referred here?" oracle.
    IF NOT EXISTS (
      SELECT 1 FROM hms_referral_duplicate_claims d
       WHERE d.code_id = v_code_id
         AND d.phone_digits = p_phone_digits
         AND d.created_at >= now() - interval '14 days'
    ) THEN
      INSERT INTO hms_referral_duplicate_claims (
        code_id, referrer_tenant_id, hostel_id, owner_id, name, phone, phone_digits, source
      ) VALUES (
        v_code_id, v_tenant_id, v_hostel_id, v_owner_id, p_name, p_phone, p_phone_digits, v_source
      );
    END IF;
    RETURN 'duplicate';
  END;

  RETURN 'ok';
END;
$function$;

revoke all on function public.hms_submit_referral(text,text,text,text,text,integer,integer,integer,integer,integer,integer) from public, anon, authenticated;
grant execute on function public.hms_submit_referral(text,text,text,text,text,integer,integer,integer,integer,integer,integer) to service_role;
