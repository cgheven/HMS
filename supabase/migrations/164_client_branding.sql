-- Client branding for the public listing site: business name + logo.
--
-- The public branded site currently prints hms_profiles.full_name as its
-- heading (app/actions/public.ts: `ownerName: profile?.full_name`), so a
-- prospect visiting a client's own domain sees the OWNER'S PERSONAL NAME where
-- a business should be — "Najam" rather than "Najam Hostels". It reads as an
-- unfinished profile on the one page a client uses to sell.
--
-- Owner-level, not per-branch, and deliberately alongside `subdomain` (migration
-- 155) because these three are the same thing: the identity of the account's
-- public site. A multi-branch client has one brand and many branches.
--
-- Both nullable with no default. full_name remains the fallback, so every
-- existing client's page renders exactly as it does today until they fill these
-- in — nothing changes on its own.

ALTER TABLE public.hms_profiles
  ADD COLUMN IF NOT EXISTS business_name text,
  ADD COLUMN IF NOT EXISTS logo_url text;

COMMENT ON COLUMN public.hms_profiles.business_name IS
  'Trading name shown on the public branded site. Falls back to full_name when null. Set by the owner in Settings.';

COMMENT ON COLUMN public.hms_profiles.logo_url IS
  'Public URL of the client logo in the hostel-covers bucket. Falls back to a generic icon when null.';

-- Length guards only — a heading, not an essay, and a URL not a data: blob.
-- Kept as CHECKs rather than app-only validation because the owner writes these
-- through the browser client (RLS "Users update own profile"), so the database
-- is the last line rather than the second.
ALTER TABLE public.hms_profiles
  DROP CONSTRAINT IF EXISTS hms_profiles_business_name_len;
ALTER TABLE public.hms_profiles
  ADD CONSTRAINT hms_profiles_business_name_len
  CHECK (business_name IS NULL OR char_length(business_name) <= 80);

ALTER TABLE public.hms_profiles
  DROP CONSTRAINT IF EXISTS hms_profiles_logo_url_len;
ALTER TABLE public.hms_profiles
  ADD CONSTRAINT hms_profiles_logo_url_len
  CHECK (logo_url IS NULL OR char_length(logo_url) <= 500);

-- No new storage bucket. hostel-covers is already public-read and its
-- owner-write policies scope on the FIRST PATH SEGMENT being a hostel the
-- caller owns, so a logo stored at {hostelId}/logo.{ext} is covered by the
-- existing rules. A separate bucket would mean duplicating three policies to
-- gain nothing.
