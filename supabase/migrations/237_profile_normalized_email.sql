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
-- NOTE (uniqueness moved to 238): the UNIQUE index is built in migration 238, and
-- is scoped to role='owner' there — NOT all-role. An earlier version of this file
-- created an ALL-ROLE unique index here, which aborts on prod because (a) prod has a
-- known duplicate (malikmajid940@gmail.com → two rows) and (b) an all-role index
-- also false-rejects a legitimate owner who is ALSO a manager/partner elsewhere on
-- the same email. 238 drops any such index and replaces it with the owner-scoped one.
-- So this migration is now purely additive (column + backfill) and cannot abort.
-- PROD PRE-FLIGHT still required before 238: de-duplicate any two OWNER rows that
-- share a canonical email (see the deploy runbook) or 238's owner-scoped index fails.

ALTER TABLE public.hms_profiles ADD COLUMN IF NOT EXISTS normalized_email text;

-- Backfill existing rows with the same rule the app applies going forward.
UPDATE public.hms_profiles
SET normalized_email = CASE
    WHEN lower(split_part(email, '@', 2)) IN ('gmail.com', 'googlemail.com')
      THEN replace(regexp_replace(lower(split_part(email, '@', 1)), '\+.*$', ''), '.', '') || '@gmail.com'
    ELSE regexp_replace(lower(split_part(email, '@', 1)), '\+.*$', '') || '@' || lower(split_part(email, '@', 2))
  END
WHERE email IS NOT NULL AND normalized_email IS NULL;

COMMENT ON COLUMN public.hms_profiles.normalized_email IS
  'Canonical email identity (lib/email-normalize.ts: +tag stripped, Gmail dots removed). UNIQUE — collapses aliases to one account. Set by account-creation server actions.';
