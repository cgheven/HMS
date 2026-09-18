-- Migration 258: referral links refuse submission until the reward is configured.
--
-- Companion to the app-side generation gate (ensureReferralCode / ensureAndSendReferralInvite
-- / getReferralTarget): the silent server-side backstop so an already-minted or guessed
-- TENANT code cannot be POSTed on a branch that has not set both reward percentages.
-- Pulse links keep their existing referred% >= 1 rule. Rebuilt from the live definition
-- (migration 198) with one added WHERE clause; the resolution simply returns 'dead_link'.

CREATE OR REPLACE FUNCTION public.hms_submit_referral(p_code text, p_name text, p_phone text, p_phone_digits text, p_ip text, p_max_pending integer, p_ip_link_hourly_limit integer, p_ip_hourly_limit integer, p_hostel_hourly_limit integer, p_pulse_max_pending integer DEFAULT 100, p_pulse_ip_link_hourly_limit integer DEFAULT 200, p_visiting_date date DEFAULT NULL::date)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_visit       date;
BEGIN
  -- Sanitised, and NULLed rather than rejected.
  --
  -- The value arrives from an anonymous form so it can be anything. A date in
  -- the past, or absurdly far ahead, is not information — it is a date the owner
  -- cannot act on. Discarding it keeps the LEAD, which is what matters.
  --
  -- Rejecting the submission instead would be worse than useless: this
  -- function's return value is observable to an anonymous caller, so a new
  -- failure mode keyed on input hands them a way to probe behaviour that every
  -- other branch here is written to hide.
  IF p_visiting_date IS NOT NULL
     AND p_visiting_date >= current_date
     AND p_visiting_date <= current_date + 60 THEN
    v_visit := p_visiting_date;
  END IF;
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
          OR coalesce(h.referral_referred_percent, 0) >= 1)
     -- Migration 258: a TENANT link is live only once the reward is CONFIGURED —
     -- both percentages >= 1 (the same rule Marketing / campaign start / invites use).
     -- Referrals are on for every branch by default, so the reward, not the flag,
     -- is the signal. Unconfigured -> NOT FOUND -> 'dead_link', so a stray/guessed
     -- code cannot be submitted on a branch that never set up an offer.
     AND (c.source = 'pulse'
          OR (coalesce(h.referral_referrer_percent, 0) >= 1
              AND coalesce(h.referral_referred_percent, 0) >= 1));

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
      promised_referrer_percent, promised_referred_percent, source, visiting_date
    ) VALUES (
      v_code_id, v_tenant_id, v_hostel_id, v_owner_id,
      p_name, p_phone, p_phone_digits, nullif(v_ip, 'unknown'),
      CASE WHEN v_is_pulse THEN 0 ELSE coalesce(v_referrer_pc, 0) END,
      coalesce(v_referred_pc, 0), v_source, v_visit
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

