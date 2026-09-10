-- Account freeze: a non-paying account can log in and READ but cannot WRITE
-- until dues are cleared. Enforced in TWO layers because HMS has two write paths:
--   1) the owner dashboard writes DIRECTLY from the browser (owner JWT, RLS only)
--   2) partner/manager + complex owner writes go through service-role actions
-- This migration is layer 1 (the DB gate that covers browser writes); the
-- app-layer requireNotFrozen() covers the service-role paths that bypass RLS.

SET lock_timeout = '3s';

-- Account-level flag, same guard pattern as plan (227) / subdomain (167):
-- only super_admin or the service-role client (auth.uid() NULL — the Paddle
-- webhook / a Super Admin action) may change it.
ALTER TABLE public.hms_profiles
  ADD COLUMN IF NOT EXISTS frozen boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.hms_profiles.frozen IS
  'Super Admin / service-role only. true = account suspended: the owner can log in and read but every write is blocked (DB triggers + app requireNotFrozen) until dues are cleared.';

CREATE OR REPLACE FUNCTION public.hms_guard_frozen()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.frozen IS DISTINCT FROM OLD.frozen
     AND auth.uid() IS NOT NULL
     AND COALESCE((SELECT role FROM public.hms_profiles WHERE id = auth.uid()), '') <> 'super_admin'
  THEN
    RAISE EXCEPTION 'frozen can only be changed by a super admin';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS hms_profiles_guard_frozen ON public.hms_profiles;
CREATE TRIGGER hms_profiles_guard_frozen
  BEFORE UPDATE ON public.hms_profiles
  FOR EACH ROW EXECUTE FUNCTION public.hms_guard_frozen();

-- The write gate. Blocks a SESSION write (auth.uid() present = a logged-in owner
-- writing from the browser) when that user's account is frozen. Service-role
-- writes (auth.uid() NULL — webhook, crons, Super Admin, and the app's own
-- server actions) pass through here and are gated at the app layer instead, so
-- the unfreeze path and system jobs keep working.
CREATE OR REPLACE FUNCTION public.hms_block_frozen_session_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.hms_profiles WHERE id = auth.uid() AND frozen)
  THEN
    RAISE EXCEPTION 'account_frozen'
      USING HINT = 'This account is suspended. Clear your outstanding dues to restore write access.';
  END IF;
  RETURN COALESCE(NEW, OLD); -- NEW for INSERT/UPDATE, OLD for DELETE
END;
$$;

-- Attach to every owner-writable business table (the direct-from-browser surface).
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'hms_rooms','hms_tenants','hms_waitlist','hms_expenses','hms_kitchen_expenses',
    'hms_food_items','hms_bills','hms_employees','hms_salary_payments',
    'hms_announcements','hms_complaints','hms_hostels','hms_profiles'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS hms_block_frozen ON public.%I', t);
      EXECUTE format(
        'CREATE TRIGGER hms_block_frozen BEFORE INSERT OR UPDATE OR DELETE ON public.%I '
        || 'FOR EACH ROW EXECUTE FUNCTION public.hms_block_frozen_session_write()', t);
    END IF;
  END LOOP;
END$$;
