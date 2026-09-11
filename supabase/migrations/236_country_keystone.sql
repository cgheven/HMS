-- COUNTRY KEYSTONE — the one attribute the whole multi-country design hangs off.
--
-- Today the system infers "Pakistan" from the shape of the data (a phone starting
-- 0, a 13-digit CNIC, a fixed UTC+5 clock, a PKR default). This adds an explicit
-- `country` to the owner and the hostel; a code-side registry (lib/country-config.ts)
-- maps a country to its currency, timezone, dial code, national-ID rule, etc.
--
-- Phase 0 is PURELY ADDITIVE: nothing reads the column yet — the central
-- primitives (currency/phone/timezone/ID) get wired to it in later phases. It is
-- a no-op for every existing client because they all default to 'PK', whose
-- registry values are exactly today's hardcodes. No destructive change.
--
-- country is an ISO 3166-1 alpha-2 code (e.g. 'PK', 'BD').

ALTER TABLE public.hms_profiles
  ADD COLUMN IF NOT EXISTS country text NOT NULL DEFAULT 'PK';

ALTER TABLE public.hms_hostels
  ADD COLUMN IF NOT EXISTS country text NOT NULL DEFAULT 'PK';

-- Format guard: two uppercase letters. Kept permissive (any ISO code) on purpose
-- — the authoritative "is this a country we support" check lives in the app
-- registry (isSupportedCountry), not the database, so onboarding a new country
-- never needs a migration. conrelid-scoped so a same-named constraint elsewhere
-- can't falsely skip creation.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'hms_profiles_country_format'
                   AND conrelid = 'public.hms_profiles'::regclass) THEN
    ALTER TABLE public.hms_profiles
      ADD CONSTRAINT hms_profiles_country_format CHECK (country ~ '^[A-Z]{2}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'hms_hostels_country_format'
                   AND conrelid = 'public.hms_hostels'::regclass) THEN
    ALTER TABLE public.hms_hostels
      ADD CONSTRAINT hms_hostels_country_format CHECK (country ~ '^[A-Z]{2}$');
  END IF;
END $$;

-- SELF-GRANT GUARD. country will drive currency/billing and feature availability
-- (e.g. the Pakistan-only Hotel Eye), so it is exactly the class of column that
-- role/plan/subdomain/custom_rate all guard. The RLS UPDATE policies on these
-- tables only pin `role`/`owner_id`; every other column — including country — is
-- writable by the owner's (and a full-access partner's) own browser session, and
-- a table-wide GRANT makes a column-level REVOKE a no-op. Only a trigger stops a
-- non-super-admin from flipping their own country to self-select currency/rate or
-- toggle a country-gated feature. auth.uid() IS NULL for the service-role client
-- (onboarding / Super Admin actions), so those pass straight through — onboarding
-- MUST set country via createAdminClient(), not a user session.
CREATE OR REPLACE FUNCTION public.hms_guard_country()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.country IS DISTINCT FROM OLD.country
     AND auth.uid() IS NOT NULL
     AND COALESCE((SELECT role FROM public.hms_profiles WHERE id = auth.uid()), '') <> 'super_admin'
  THEN
    RAISE EXCEPTION 'country can only be changed by a super admin';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS hms_profiles_guard_country ON public.hms_profiles;
CREATE TRIGGER hms_profiles_guard_country
  BEFORE UPDATE ON public.hms_profiles
  FOR EACH ROW EXECUTE FUNCTION public.hms_guard_country();

DROP TRIGGER IF EXISTS hms_hostels_guard_country ON public.hms_hostels;
CREATE TRIGGER hms_hostels_guard_country
  BEFORE UPDATE ON public.hms_hostels
  FOR EACH ROW EXECUTE FUNCTION public.hms_guard_country();

COMMENT ON COLUMN public.hms_profiles.country IS
  'ISO 3166-1 alpha-2 country of the account owner (billing / legal / default for new hostels). Pointer into lib/country-config.ts. super-admin-only (hms_guard_country). Defaults to PK.';
COMMENT ON COLUMN public.hms_hostels.country IS
  'ISO 3166-1 alpha-2 country the hostel operates in (drives currency, timezone, national-ID rules, feature/integration availability). Pointer into lib/country-config.ts. super-admin-only (hms_guard_country). Defaults to PK.';
