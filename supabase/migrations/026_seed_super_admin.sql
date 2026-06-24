-- Migration 026: Bootstrap the platform super admin account
DO $$
DECLARE
  trigger_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    WHERE t.tgname = 'hms_prevent_role_self_escalation'
      AND c.relname = 'hms_profiles'
  ) INTO trigger_exists;

  IF trigger_exists THEN
    ALTER TABLE hms_profiles DISABLE TRIGGER hms_prevent_role_self_escalation;
  END IF;

  UPDATE hms_profiles
  SET role = 'super_admin'
  WHERE email = 'admin@yourpulse.io';

  IF trigger_exists THEN
    ALTER TABLE hms_profiles ENABLE TRIGGER hms_prevent_role_self_escalation;
  END IF;
END;
$$;
