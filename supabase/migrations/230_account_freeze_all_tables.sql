-- Fix: migration 229 hand-listed 13 tables for the freeze trigger, but an owner
-- can write MANY more tables directly from the browser (RLS owner-write policies)
-- — including every financial table (hms_payments, hms_payment_installments,
-- hms_salary_advances, hms_package_configs, ...). Those had no trigger, so a
-- frozen owner could PATCH them directly via PostgREST with their own JWT. Full
-- write bypass.
--
-- Root cause was hand-maintaining the list. Fix it structurally: the block
-- trigger is a NO-OP unless auth.uid() is a frozen owner (service-role/auth.uid()
-- NULL and every non-frozen user short-circuit), so attaching it to EVERY app
-- table is safe and removes the drift risk entirely. Coverage now == every
-- public.hms_* base table, so a new owner-writable table can never be missed.

SET lock_timeout = '5s';

DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'                 -- ordinary tables only (no views/partitions)
      AND c.relname LIKE 'hms\_%'
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS hms_block_frozen ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER hms_block_frozen BEFORE INSERT OR UPDATE OR DELETE ON public.%I '
      || 'FOR EACH ROW EXECUTE FUNCTION public.hms_block_frozen_session_write()', t);
  END LOOP;
END$$;
