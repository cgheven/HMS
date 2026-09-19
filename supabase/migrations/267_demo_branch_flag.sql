-- Migration 267: mark a branch as one-click sample/demo data.
--
-- New self-reg owners land on a blank dashboard. "Explore with sample data"
-- seeds a DEDICATED demo branch (its own hms_hostels row) full of realistic
-- rooms/residents/payments/expenses/complaints/menu so they can see the product
-- in action, then remove it in one click.
--
-- The demo branch is kept OUT of billing and the public site by the existing
-- flags (billing_active=false, listing_enabled=false) — no new exclusion logic.
-- is_demo is only a reliable MARKER so the app can: show the "sample data" banner,
-- enforce one demo per owner, and target the correct branch for one-click removal.
--
-- Guarded like every other sensitive branch/billing flag: a user session must not
-- be able to flip is_demo on a REAL branch (which would surface the "remove sample
-- data" action and let them one-click-delete real data). Only the service role
-- (auth.uid() IS NULL — the seeder/remover) or a super_admin may change it.

SET lock_timeout = '3s';

ALTER TABLE public.hms_hostels
  ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.hms_hostels.is_demo IS
  'True only for a one-click sample-data branch (seeded via service role). Kept out '
  'of billing/listing via billing_active=false + listing_enabled=false; this flag is '
  'only a marker for the banner, one-per-owner, and one-click removal. Guarded: '
  'super-admin (or service role) only.';

CREATE OR REPLACE FUNCTION public.hms_guard_is_demo()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.is_demo IS DISTINCT FROM OLD.is_demo
     AND auth.uid() IS NOT NULL
     AND COALESCE((SELECT role FROM public.hms_profiles WHERE id = auth.uid()), '') <> 'super_admin'
  THEN
    RAISE EXCEPTION 'is_demo can only be changed by a super admin';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS hms_hostels_guard_is_demo ON public.hms_hostels;
CREATE TRIGGER hms_hostels_guard_is_demo
  BEFORE UPDATE ON public.hms_hostels
  FOR EACH ROW EXECUTE FUNCTION public.hms_guard_is_demo();

-- One demo branch per owner, enforced at the DB (the seeder's check-then-insert is
-- otherwise a TOCTOU race — two concurrent "Explore" clicks would each create one,
-- and .maybeSingle() then breaks load + remove). A racing second insert now fails
-- with a clean duplicate-key error the seeder handles.
CREATE UNIQUE INDEX IF NOT EXISTS uq_hms_hostels_one_demo_per_owner
  ON public.hms_hostels (owner_id) WHERE is_demo;
