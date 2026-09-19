-- Migration 262: first-login setup welcome flow.
--
-- Adds a single nullable stamp to hms_profiles. NULL = the owner has never
-- finished or skipped the welcome checklist, so the dashboard sends them to
-- /welcome once on first login. Set (to now()) when they click "Skip for now"
-- or "Finish" — after that they are never force-redirected again; a slim resume
-- card on the dashboard is their only nudge until setup is complete.
--
-- Derived, not stored: which individual steps are done is computed live from the
-- real data (rooms exist, wifi set, etc.) — this column only records the
-- one thing that can't be derived, "I have seen and dismissed the welcome".
--
-- Backfill every EXISTING profile to "dismissed" so no current client is ever
-- pulled into the welcome flow — only accounts created AFTER this migration
-- (new sign-ups, whose fresh profile row reads NULL) will see it. This is the
-- only data touched; no hostel/tenant/payment row changes, so PK stays
-- byte-identical for the money tables.

ALTER TABLE public.hms_profiles
  ADD COLUMN IF NOT EXISTS onboarding_dismissed_at timestamptz;

UPDATE public.hms_profiles
   SET onboarding_dismissed_at = now()
 WHERE onboarding_dismissed_at IS NULL;
