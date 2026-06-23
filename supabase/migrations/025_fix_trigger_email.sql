-- Migration 025: Fix hms_handle_new_user trigger to include email column
-- The original trigger from migration 001 included email; migration 023 overwrote
-- it without email, causing NOT NULL constraint violations on new signups.

CREATE OR REPLACE FUNCTION hms_handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO hms_profiles (id, email, full_name, phone, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'phone', NULL),
    'owner'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
