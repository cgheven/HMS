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
-- country is an ISO 3166-1 alpha-2 code (e.g. 'PK', 'BD'). It is set by
-- server-side actions (onboarding / super-admin); owners have no RLS write path
-- to these tables' restricted columns, so no extra guard trigger is needed here —
-- the DEFAULT covers every existing and near-term row.

ALTER TABLE public.hms_profiles
  ADD COLUMN IF NOT EXISTS country text NOT NULL DEFAULT 'PK';

ALTER TABLE public.hms_hostels
  ADD COLUMN IF NOT EXISTS country text NOT NULL DEFAULT 'PK';

-- Format guard: two uppercase letters. Kept permissive (any ISO code) on purpose
-- — the authoritative "is this a country we support" check lives in the app
-- registry, not the database, so onboarding a new country never needs a migration.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hms_profiles_country_format') THEN
    ALTER TABLE public.hms_profiles
      ADD CONSTRAINT hms_profiles_country_format CHECK (country ~ '^[A-Z]{2}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hms_hostels_country_format') THEN
    ALTER TABLE public.hms_hostels
      ADD CONSTRAINT hms_hostels_country_format CHECK (country ~ '^[A-Z]{2}$');
  END IF;
END $$;

COMMENT ON COLUMN public.hms_profiles.country IS
  'ISO 3166-1 alpha-2 country of the account owner (billing / legal / default for new hostels). Pointer into lib/country-config.ts. Defaults to PK.';
COMMENT ON COLUMN public.hms_hostels.country IS
  'ISO 3166-1 alpha-2 country the hostel operates in (drives currency, timezone, national-ID rules, feature/integration availability). Pointer into lib/country-config.ts. Defaults to PK.';
