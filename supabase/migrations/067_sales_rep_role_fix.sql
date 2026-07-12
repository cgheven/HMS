-- Security fix (found by adversarial review of the Sales CRM feature): sales-rep
-- auth users must not receive role='owner' from the new-user trigger — same bug
-- class already fixed for managers in 057_fix_manager_role_and_auth.sql, reintroduced
-- because that trigger only special-cased 'manager', not the new 'sales_rep' metadata.

ALTER TABLE hms_profiles
  DROP CONSTRAINT IF EXISTS hms_profiles_role_check;

ALTER TABLE hms_profiles
  ADD CONSTRAINT hms_profiles_role_check
    CHECK (role IN ('super_admin', 'owner', 'partner', 'manager', 'sales_rep'));

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
      WHEN NEW.raw_user_meta_data->>'role' = 'manager'   THEN 'manager'
      WHEN NEW.raw_user_meta_data->>'role' = 'sales_rep' THEN 'sales_rep'
      ELSE 'owner'
    END
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Backfill any sales rep already provisioned before this fix landed.
UPDATE hms_profiles
SET role = 'sales_rep'
WHERE role != 'sales_rep'
  AND id IN (SELECT supabase_user_id FROM hms_sales_reps WHERE supabase_user_id IS NOT NULL);

-- Data-integrity fix: created_by is provenance, not ownership — deleting the
-- super_admin who created a batch of reps must not cascade-delete the roster.
ALTER TABLE hms_sales_reps DROP CONSTRAINT IF EXISTS hms_sales_reps_created_by_fkey;
ALTER TABLE hms_sales_reps ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE hms_sales_reps
  ADD CONSTRAINT hms_sales_reps_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
