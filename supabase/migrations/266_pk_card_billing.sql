-- Migration 266: opt PK owners onto Paddle card billing (per-owner, explicit).
--
-- Pakistan is otherwise a manual/bank-invoice market (lib/country-config
-- manualBankBilling). We now let NEW self-registered PK owners pay by card via
-- Paddle at a per-branch USD rate ($15/branch/month, $150/branch/year), while
-- EXISTING PK clients stay on manual bank billing, untouched.
--
-- The rail must be a per-owner decision, not a country flip: some existing PK
-- clients already carry a custom USD rate (e.g. the legacy $18 clients), so keying
-- the card rail off "has a custom rate" would wrongly sweep them onto card
-- checkout. This explicit flag is the ONLY signal for the card rail.
--
-- DEFAULT false + no backfill => every existing account (PK or otherwise) is
-- provably unaffected. verifySignupAndProvision sets it true (with
-- custom_unit_amount_usd = 15, the per-branch price the checkout math already
-- uses) for a new PK self-reg owner only. The billing UI and createPlanCheckoutAction
-- read it as: manual owner is on cards iff pk_card_enabled.

SET lock_timeout = '3s';

ALTER TABLE public.hms_profiles
  ADD COLUMN IF NOT EXISTS pk_card_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.hms_profiles.pk_card_enabled IS
  'PK owner is on Paddle card billing, not manual/bank. Set true only for new '
  'self-registered PK owners; false for every existing account. The sole card-rail '
  'signal for a manual-bank-country owner. Guarded: super-admin (or service role) only.';

-- Guard: pk_card_enabled is billing-critical, exactly like plan/frozen/country/
-- custom_unit_amount_usd/trial_ends_at. hms_profiles grants table-wide UPDATE to
-- authenticated and the "update own profile" RLS policy pins ONLY role, so without
-- this trigger an owner could PostgREST-UPDATE their own pk_card_enabled and move
-- themselves off manual invoicing onto the card rail (a self-grant of a billing
-- rail). Service role (auth.uid() IS NULL — signup provisioning, webhook,
-- super-admin actions) passes; a super_admin session passes; any other session
-- that changes the value is rejected. Mirrors hms_guard_trial_ends_at (migration 241).
CREATE OR REPLACE FUNCTION public.hms_guard_pk_card_enabled()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.pk_card_enabled IS DISTINCT FROM OLD.pk_card_enabled
     AND auth.uid() IS NOT NULL
     AND COALESCE((SELECT role FROM public.hms_profiles WHERE id = auth.uid()), '') <> 'super_admin'
  THEN
    RAISE EXCEPTION 'pk_card_enabled can only be changed by a super admin';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS hms_profiles_guard_pk_card_enabled ON public.hms_profiles;
CREATE TRIGGER hms_profiles_guard_pk_card_enabled
  BEFORE UPDATE ON public.hms_profiles
  FOR EACH ROW EXECUTE FUNCTION public.hms_guard_pk_card_enabled();
