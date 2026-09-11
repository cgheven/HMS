-- ABUSE CONTROL — canonical email identity on hms_profiles.
--
-- There is no unique index on hms_profiles.email today, and app-level dup checks
-- are racy, so a person can create multiple accounts (esp. free trials) with +tag
-- aliases (you+1@, you+2@) or Gmail dot variants (d.e.m.o@ == demo@). This adds a
-- normalized_email canonical form + a UNIQUE index, so aliases collapse to one
-- identity at the DB level (race-safe) while a real user is never rejected.
--
-- The canonicalization here MUST match lib/email-normalize.ts normalizeEmail():
--   lower(trim) → strip +tag from local part → for gmail/googlemail strip dots and
--   canonicalize the domain to gmail.com.
-- Account-creation server actions write normalized_email via that function.
--
-- PROD CAVEAT: this is applied to STAGE only. Production currently has a duplicate
-- (malikmajid940@gmail.com resolves to two hms_profiles rows); the UNIQUE index
-- would fail there until that duplicate is resolved. Do not apply to prod before
-- de-duplicating.

ALTER TABLE public.hms_profiles ADD COLUMN IF NOT EXISTS normalized_email text;

-- Backfill existing rows with the same rule the app applies going forward.
UPDATE public.hms_profiles
SET normalized_email = CASE
    WHEN lower(split_part(email, '@', 2)) IN ('gmail.com', 'googlemail.com')
      THEN replace(regexp_replace(lower(split_part(email, '@', 1)), '\+.*$', ''), '.', '') || '@gmail.com'
    ELSE regexp_replace(lower(split_part(email, '@', 1)), '\+.*$', '') || '@' || lower(split_part(email, '@', 2))
  END
WHERE email IS NOT NULL AND normalized_email IS NULL;

-- Partial unique index: one account per canonical email. NULLs (a profile row with
-- no email — shouldn't happen, but defensively) are exempt.
CREATE UNIQUE INDEX IF NOT EXISTS hms_profiles_normalized_email_unique
  ON public.hms_profiles (normalized_email) WHERE normalized_email IS NOT NULL;

COMMENT ON COLUMN public.hms_profiles.normalized_email IS
  'Canonical email identity (lib/email-normalize.ts: +tag stripped, Gmail dots removed). UNIQUE — collapses aliases to one account. Set by account-creation server actions.';
