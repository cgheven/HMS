-- Tiered per-country pricing adds two plans: Business (≤10 properties) and
-- Enterprise (10+, custom). Widen the hms_profiles.plan CHECK so the webhook /
-- super-admin can stamp them. Purely additive — existing 'basic'/'standard' rows
-- are unaffected, and the hms_guard_plan write-guard trigger is left untouched
-- (only super-admin / service-role may change plan).
--
-- LOAD-BEARING: without this, a webhook write of plan='business' throws and the
-- paid account stays un-entitled. Must be applied before any business/enterprise
-- checkout completes.

ALTER TABLE public.hms_profiles
  DROP CONSTRAINT IF EXISTS hms_profiles_plan_check;

ALTER TABLE public.hms_profiles
  ADD CONSTRAINT hms_profiles_plan_check
  CHECK (plan IS NULL OR plan = ANY (ARRAY['basic'::text, 'standard'::text, 'business'::text, 'enterprise'::text]));
