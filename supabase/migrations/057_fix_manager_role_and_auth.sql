-- Security fix: manager auth users must not receive role='owner' from the new-user trigger.
--
-- Two changes:
--   1. Extend the hms_profiles.role CHECK constraint to allow 'manager'.
--   2. Replace hms_handle_new_user() so it reads raw_user_meta_data->>'role' and
--      assigns 'manager' when the metadata says so, 'owner' otherwise.
--      This prevents createManagerLogin() calls from silently escalating staff to owner tier.

-- 1. Widen the CHECK constraint (non-breaking; existing rows all have 'owner'/'super_admin'/'partner')
ALTER TABLE hms_profiles
  DROP CONSTRAINT IF EXISTS hms_profiles_role_check;

ALTER TABLE hms_profiles
  ADD CONSTRAINT hms_profiles_role_check
    CHECK (role IN ('super_admin', 'owner', 'partner', 'manager'));

-- 2. Replace the trigger function
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
    CASE
      WHEN NEW.raw_user_meta_data->>'role' = 'manager' THEN 'manager'
      ELSE 'owner'
    END
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
