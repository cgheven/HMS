-- Migration 257: referrals are a FREE feature, DEFAULT-ON for every branch.
--
-- Product decision: the tenant-to-tenant referral programme is free (no Pulse
-- commission charged) and available to every client by default, on every plan
-- (Basic included) and on trial/self-registered accounts. Enabling only makes the
-- feature AVAILABLE — it never auto-sends: invites still require the owner to
-- activate the campaign (referral_campaign = 'active') and set reward %s >= 1.
--
-- Three parts:
--   1. Column DEFAULT true, so every NEW branch starts with referrals on.
--   2. Relax the self-grant guard's INSERT check on referral_enabled — without
--      this, an owner-created branch INSERT carrying the true default is rejected
--      (createBranch runs under the user-scoped client, auth.uid() not null). The
--      percentage and Pulse-commission protections are kept, and the UPDATE guard
--      is kept (only Super Admin can change referral_enabled after creation).
--   3. Backfill existing OFF branches to true (service-role passes the guard).
--
-- The plan no longer drives referral_enabled (lib/entitlements.ts stops writing it),
-- so nothing turns it back off. Super Admin can still disable one branch via
-- setReferralEnabled. No commission change — the commission is report-only and
-- already 0 on prod; it is simply never charged.

-- 1. Default-on for new branches.
ALTER TABLE public.hms_hostels ALTER COLUMN referral_enabled SET DEFAULT true;

-- 2. Relax the INSERT guard on referral_enabled (percent + commission stay guarded).
CREATE OR REPLACE FUNCTION public.hms_prevent_referral_self_grant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- referral_enabled INSERT block REMOVED (migration 257): referrals are a FREE,
    -- default-on feature, so an owner-created branch carrying the true default is
    -- expected and allowed. Percentages and the Pulse commission stay Super-Admin only.
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
$function$;

-- 3. Backfill existing OFF branches. Runs as service-role (auth.uid() null), so the
-- UPDATE guard passes; the AFTER trigger mints each branch's Pulse code (idempotent).
UPDATE public.hms_hostels SET referral_enabled = true WHERE referral_enabled = false;
