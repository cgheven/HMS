-- hms_handle_new_profile() creates a starter "My Hostel" for every new profile.
-- Migration 032 excluded super_admin, but the check was written as a single
-- negative case rather than a positive allowlist, so it still fires for every
-- other non-owner role. Since 091 started assigning role='partner' correctly at
-- INSERT time, every partner created through Settings > Partners has silently
-- received a phantom hostel owned by themselves. Managers and sales reps have
-- been getting one all along.
--
-- Three concrete problems, in increasing order of severity:
--   1. Junk rows nobody can reach through the UI.
--   2. listing_enabled defaults to true, so each phantom is published to the
--      PUBLIC directory at /find as an empty, nameless-looking hostel.
--   3. It hands a partner/manager account a hostel they own outright. The
--      "Owner manages own hostel" policy is `auth.uid() = owner_id`, so that
--      row is fully writable by them — a foothold that exists for no reason.
--
-- Fix the trigger to an explicit allowlist, then remove the phantoms that are
-- provably unused.

CREATE OR REPLACE FUNCTION hms_handle_new_profile()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Allowlist, not a blocklist: only a real hostel owner gets a starter hostel.
  -- partner / manager / sales_rep reach their hostels through hms_partnerships
  -- and hms_manager_hostels, and super_admin manages the platform.
  IF NEW.role IS DISTINCT FROM 'owner' THEN
    RETURN NEW;
  END IF;
  INSERT INTO hms_hostels (owner_id, name, listing_enabled)
  VALUES (NEW.id, 'My Hostel', true);
  RETURN NEW;
END;
$$;

-- Remove existing phantoms. Deliberately conservative: a hostel is only removed
-- if it is owned by a non-owner role AND still carries the untouched default
-- name AND has no rooms, tenants or payments. Anything a human has actually
-- used is left alone, even if it was created this way.
DELETE FROM hms_hostels h
USING hms_profiles p
WHERE p.id = h.owner_id
  AND p.role <> 'owner'
  AND h.name = 'My Hostel'
  AND NOT EXISTS (SELECT 1 FROM hms_rooms    r  WHERE r.hostel_id  = h.id)
  AND NOT EXISTS (SELECT 1 FROM hms_tenants  t  WHERE t.hostel_id  = h.id)
  AND NOT EXISTS (SELECT 1 FROM hms_payments pm WHERE pm.hostel_id = h.id);
