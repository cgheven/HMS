-- Close the writer-vs-account residual. hms_block_frozen (migrations 229/230)
-- keys on the WRITER's frozen flag, so a non-frozen delegate — a full-tier
-- partner — could still browser-write a FROZEN owner's rows on tables where
-- partners hold RLS write (hms_package_configs, hms_salary_advances, ...).
--
-- This adds an ACCOUNT-based block: any authenticated session (owner OR a
-- partner/manager delegate) writing a row whose ACCOUNT OWNER is frozen is
-- blocked. Service-role (auth.uid() NULL — webhook/cron/super-admin) still
-- passes. Attached to every table carrying hostel_id (owner via the hostel) and
-- to hms_hostels (owner via owner_id). Coexists with hms_block_frozen.

SET lock_timeout = '5s';

-- Branch-scoped tables: owner = hms_hostels.owner_id for the row's hostel_id.
CREATE OR REPLACE FUNCTION public.hms_block_frozen_by_hostel()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_hostel uuid; v_owner uuid;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    v_hostel := CASE WHEN TG_OP = 'DELETE' THEN OLD.hostel_id ELSE NEW.hostel_id END;
    IF v_hostel IS NOT NULL THEN
      SELECT owner_id INTO v_owner FROM public.hms_hostels WHERE id = v_hostel;
      IF v_owner IS NOT NULL AND EXISTS (SELECT 1 FROM public.hms_profiles WHERE id = v_owner AND frozen) THEN
        RAISE EXCEPTION 'account_frozen'
          USING HINT = 'This account is suspended. Clear the outstanding dues to restore write access.';
      END IF;
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;$$;

-- hms_hostels itself: owner = owner_id.
CREATE OR REPLACE FUNCTION public.hms_block_frozen_by_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_owner uuid;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    v_owner := CASE WHEN TG_OP = 'DELETE' THEN OLD.owner_id ELSE NEW.owner_id END;
    IF v_owner IS NOT NULL AND EXISTS (SELECT 1 FROM public.hms_profiles WHERE id = v_owner AND frozen) THEN
      RAISE EXCEPTION 'account_frozen'
        USING HINT = 'This account is suspended. Clear the outstanding dues to restore write access.';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;$$;

-- Attach the by-hostel block to every base table that has a hostel_id column.
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'hostel_id' AND a.attnum > 0 AND NOT a.attisdropped
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname LIKE 'hms\_%'
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS hms_block_frozen_acct ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER hms_block_frozen_acct BEFORE INSERT OR UPDATE OR DELETE ON public.%I '
      || 'FOR EACH ROW EXECUTE FUNCTION public.hms_block_frozen_by_hostel()', t);
  END LOOP;
END$$;

-- hms_hostels: owner is on the row itself.
DROP TRIGGER IF EXISTS hms_block_frozen_acct ON public.hms_hostels;
CREATE TRIGGER hms_block_frozen_acct BEFORE INSERT OR UPDATE OR DELETE ON public.hms_hostels
  FOR EACH ROW EXECUTE FUNCTION public.hms_block_frozen_by_owner();
