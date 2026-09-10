-- Account-level Pulse SaaS plan (Basic / Standard) — the entitlement anchor for
-- feature gating. Billing is account-level (follows owner_id), so this lives on
-- hms_profiles alongside subdomain_enabled (migration 167), not per-branch.
--
-- NULLABLE on purpose: a row with plan IS NULL means "no explicit plan" and the
-- app falls back to today's per-capability flags (legacy behavior) — so adding
-- this column blocks nobody. Real clients are seeded to their plan at deploy;
-- the Paddle webhook sets it automatically for anyone who self-pays.

SET lock_timeout = '3s';

ALTER TABLE public.hms_profiles
  ADD COLUMN IF NOT EXISTS plan text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'hms_profiles_plan_check'
  ) THEN
    ALTER TABLE public.hms_profiles
      ADD CONSTRAINT hms_profiles_plan_check CHECK (plan IN ('basic', 'standard'));
  END IF;
END$$;

COMMENT ON COLUMN public.hms_profiles.plan IS
  'Super Admin / Paddle-webhook only. Account-level Pulse plan: basic | standard | NULL. NULL = no explicit plan, app falls back to legacy per-capability flags (blocks nothing). Drives Standard-only feature entitlement (branded subdomain, referral engine).';

-- Pinned against client self-grant, same reasoning as subdomain_enabled
-- (migration 167) / whatsapp_enabled (110): a table-wide GRANT makes a
-- column-level REVOKE a no-op, so only a trigger actually stops an owner from
-- flipping their own plan to standard from the browser and self-granting a paid
-- feature. auth.uid() IS NULL for the service-role client (Super Admin action +
-- the Paddle webhook), so those pass straight through.
CREATE OR REPLACE FUNCTION public.hms_guard_plan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.plan IS DISTINCT FROM OLD.plan
     AND auth.uid() IS NOT NULL
     AND COALESCE((SELECT role FROM public.hms_profiles WHERE id = auth.uid()), '') <> 'super_admin'
  THEN
    RAISE EXCEPTION 'plan can only be changed by a super admin';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS hms_profiles_guard_plan ON public.hms_profiles;
CREATE TRIGGER hms_profiles_guard_plan
  BEFORE UPDATE ON public.hms_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.hms_guard_plan();
