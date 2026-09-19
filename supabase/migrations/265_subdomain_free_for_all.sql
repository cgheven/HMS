-- Migration 265: branded subdomain is now free for everyone.
--
-- "Choose your address" (the {label}.hostels.yourpulse.io branded subdomain) used
-- to be a paid add-on: hms_profiles.subdomain_enabled was DRIVEN by the plan
-- (lib/entitlements.ts brandedSubdomain → paid tiers only) and applyPlanEntitlements
-- flipped it on a Paddle event. It is now a free feature for every account, so:
--
--   1. Flip the column DEFAULT to true, so every NEW self-registered / trial owner
--      can claim their address without waiting for a plan/webhook event (those
--      cohorts never fire applyPlanEntitlements).
--   2. Backfill every EXISTING account to true, since a plan sync only runs on plan
--      events — Basic and trial owners would otherwise stay locked.
--
-- migration 167 already guarantees a downgrade never tears down an already-claimed
-- subdomain, and entitlementsForPlan now returns brandedSubdomain: true for all
-- plans, so nothing re-locks these. Super Admin can still override one account via
-- setClientSubdomainEnabled.

ALTER TABLE public.hms_profiles ALTER COLUMN subdomain_enabled SET DEFAULT true;

UPDATE public.hms_profiles
   SET subdomain_enabled = true
 WHERE subdomain_enabled IS DISTINCT FROM true;
