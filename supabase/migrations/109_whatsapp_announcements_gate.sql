-- WhatsApp announcement broadcasting is a curated feature, independent of the
-- existing auto_reminder_enabled grant — a hostel could have one without the
-- other. Defaults to false for every existing and new hostel.
alter table hms_hostels
  add column if not exists whatsapp_announcements_enabled boolean not null default false;

-- Pin against modification by the hostel's own owner session — mirrors
-- hms_prevent_auto_reminder_self_grant() from migration 106 exactly. The
-- "Owner manages own hostel" FOR ALL policy (001) grants UPDATE on every
-- column since RLS has no column-level granularity, so this must be blocked
-- by trigger rather than policy.
CREATE OR REPLACE FUNCTION hms_prevent_whatsapp_announcements_self_grant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.whatsapp_announcements_enabled IS DISTINCT FROM OLD.whatsapp_announcements_enabled AND auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Forbidden: whatsapp_announcements_enabled can only be changed by Super Admin';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS hms_block_whatsapp_announcements_self_grant ON hms_hostels;

CREATE TRIGGER hms_block_whatsapp_announcements_self_grant
  BEFORE UPDATE ON hms_hostels
  FOR EACH ROW
  EXECUTE FUNCTION hms_prevent_whatsapp_announcements_self_grant();

-- Broadcast status per announcement — lets the UI show "Sent to WhatsApp"
-- instead of re-showing the send button, and gives the owner a reach count.
alter table hms_announcements
  add column if not exists whatsapp_sent_at timestamptz,
  add column if not exists whatsapp_sent_count integer not null default 0;
