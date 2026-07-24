-- Consolidate the two separate WhatsApp gates (auto_reminder_enabled,
-- whatsapp_announcements_enabled) into one flag. Product decision: WhatsApp
-- is sold/granted as a single package covering both payment reminders and
-- announcement broadcasts — a hostel doesn't buy them separately, so the
-- code shouldn't gate them separately either.

-- Drop the announcements-only gate added in 109 — no hostel had it enabled
-- yet (verified live), so this is a clean removal, not a data migration.
DROP TRIGGER IF EXISTS hms_block_whatsapp_announcements_self_grant ON hms_hostels;
DROP FUNCTION IF EXISTS hms_prevent_whatsapp_announcements_self_grant();
alter table hms_hostels drop column if exists whatsapp_announcements_enabled;

-- Rename the reminders-only gate to the generic name — RENAME COLUMN
-- preserves the existing true/false values, so Al Noor Boys Hostel (the one
-- branch already granted) keeps WhatsApp access unchanged, now covering
-- announcements too. Guarded so re-running this file (e.g. a manual replay
-- during deploy recovery) is a clean no-op once the rename has landed,
-- instead of failing with "column auto_reminder_enabled does not exist".
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'hms_hostels' AND column_name = 'auto_reminder_enabled'
  ) THEN
    ALTER TABLE hms_hostels RENAME COLUMN auto_reminder_enabled TO whatsapp_enabled;
  END IF;
END $$;

-- Old trigger/function referenced the old column name by identifier, so it
-- must be dropped and recreated rather than just renamed.
DROP TRIGGER IF EXISTS hms_block_auto_reminder_self_grant ON hms_hostels;
DROP FUNCTION IF EXISTS hms_prevent_auto_reminder_self_grant();

CREATE OR REPLACE FUNCTION hms_prevent_whatsapp_self_grant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.whatsapp_enabled IS DISTINCT FROM OLD.whatsapp_enabled AND auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Forbidden: whatsapp_enabled can only be changed by Super Admin';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS hms_block_whatsapp_self_grant ON hms_hostels;

CREATE TRIGGER hms_block_whatsapp_self_grant
  BEFORE UPDATE ON hms_hostels
  FOR EACH ROW
  EXECUTE FUNCTION hms_prevent_whatsapp_self_grant();
