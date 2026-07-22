-- Pin hms_hostels.auto_reminder_enabled against modification by the hostel's
-- own owner session.
--
-- The "Owner manages own hostel" FOR ALL policy (001) grants UPDATE on every
-- column, since Postgres RLS has no column-level granularity — exactly the
-- same class of gap 097 already fixed for owner_id. Verified exploitable
-- before writing this fix: a hostel owner's own authenticated browser
-- session, via the client Supabase library (not the admin/service-role
-- client the app's own code uses), could run
--   supabase.from('hms_hostels').update({ auto_reminder_enabled: true }).eq('id', myHostelId)
-- and it would succeed — silently self-granting a feature that's supposed to
-- require an explicit Super Admin decision (app/actions/super-admin.ts
-- setAutoReminderEnabled), with no audit log entry since that path was never
-- touched.
--
-- Mirrors hms_prevent_hostel_owner_change() from 097 exactly: auth.uid() is
-- NULL under the service role, so setAutoReminderEnabled's createAdminClient()
-- write is unaffected; only a real end-user session gets blocked.

CREATE OR REPLACE FUNCTION hms_prevent_auto_reminder_self_grant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.auto_reminder_enabled IS DISTINCT FROM OLD.auto_reminder_enabled AND auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Forbidden: auto_reminder_enabled can only be changed by Super Admin';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS hms_block_auto_reminder_self_grant ON hms_hostels;

CREATE TRIGGER hms_block_auto_reminder_self_grant
  BEFORE UPDATE ON hms_hostels
  FOR EACH ROW
  EXECUTE FUNCTION hms_prevent_auto_reminder_self_grant();
