-- Migration 032: Remove phantom hostel for super_admin and guard the trigger
-- The hms_handle_new_profile trigger auto-creates a hostel for every new profile,
-- including super_admin accounts that don't need one.

-- 1. Delete the orphaned "My Hostel" for admin@yourpulse.io (super_admin)
DELETE FROM hms_hostels
WHERE owner_id IN (
  SELECT p.id FROM hms_profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE p.role = 'super_admin'
);

-- 2. Replace the trigger function so it skips super_admin profiles
CREATE OR REPLACE FUNCTION hms_handle_new_profile()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- super_admin accounts manage the platform; they don't own hostels
  IF NEW.role = 'super_admin' THEN
    RETURN NEW;
  END IF;
  INSERT INTO hms_hostels (owner_id, name, listing_enabled)
  VALUES (NEW.id, 'My Hostel', true);
  RETURN NEW;
END;
$$;
