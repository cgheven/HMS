-- Migration 024: Security Fixes
-- Addresses findings F-001, F-003, F-006, F-007 from penetration test.

-- ============================================================
-- F-003 FIX: SECURITY DEFINER function for super_admin check
-- Breaks the recursive RLS cycle introduced in migration 023.
-- ============================================================

CREATE OR REPLACE FUNCTION hms_is_super_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT coalesce(
    (SELECT role = 'super_admin' FROM hms_profiles WHERE id = auth.uid()),
    false
  )
$$;

-- ============================================================
-- F-001 FIX: Prevent role self-escalation via UPDATE
-- Replace the unrestricted UPDATE policy on hms_profiles with
-- one that blocks changes to the `role` column by non-super-admins.
-- ============================================================

DROP POLICY IF EXISTS "User can update own profile" ON hms_profiles;

CREATE POLICY "User can update own profile"
  ON hms_profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    AND (
      -- Allow role change only if caller is already a super_admin
      -- (hms_is_super_admin() uses SECURITY DEFINER to avoid recursion)
      role = (SELECT role FROM hms_profiles WHERE id = auth.uid())
      OR hms_is_super_admin()
    )
  );

-- F-001 FIX (belt-and-suspenders): BEFORE UPDATE trigger that rejects
-- any attempt to change `role` unless the caller is already a super_admin.
CREATE OR REPLACE FUNCTION hms_prevent_role_self_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    -- Check caller's current role directly (bypasses RLS via SECURITY DEFINER)
    IF NOT EXISTS (
      SELECT 1 FROM hms_profiles WHERE id = auth.uid() AND role = 'super_admin'
    ) THEN
      RAISE EXCEPTION 'Forbidden: only super_admin can change role';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS hms_block_role_escalation ON hms_profiles;

CREATE TRIGGER hms_block_role_escalation
  BEFORE UPDATE ON hms_profiles
  FOR EACH ROW
  EXECUTE FUNCTION hms_prevent_role_self_escalation();

-- ============================================================
-- F-003 FIX: Replace recursive SELECT policies on hms_profiles
-- with the non-recursive SECURITY DEFINER pattern.
-- ============================================================

-- Drop the recursive "Super admin can view all profiles" policy from migration 023
DROP POLICY IF EXISTS "Super admin can view all profiles" ON hms_profiles;

-- Drop the old combined policy from migration 016 (will be replaced)
DROP POLICY IF EXISTS "Users read own profile, admin reads all" ON hms_profiles;

-- Single non-recursive SELECT policy: own row always readable; super_admin reads all
CREATE POLICY "Users read own profile, super admin reads all"
  ON hms_profiles FOR SELECT
  USING (auth.uid() = id OR hms_is_super_admin());

-- ============================================================
-- F-003 FIX: Replace recursive policies on hms_owner_hostels
-- ============================================================

DROP POLICY IF EXISTS "Super admin sees all junction rows" ON hms_owner_hostels;

CREATE POLICY "Super admin sees all junction rows"
  ON hms_owner_hostels FOR SELECT
  USING (hms_is_super_admin());

-- ============================================================
-- F-003 FIX: Replace recursive super_admin policies on
-- hms_partnerships, hms_platform_leads, hms_tenant_applications
-- ============================================================

DROP POLICY IF EXISTS "Super admin can view all partnerships" ON hms_partnerships;
CREATE POLICY "Super admin can view all partnerships"
  ON hms_partnerships FOR SELECT
  USING (hms_is_super_admin());

DROP POLICY IF EXISTS "Super admin can manage leads" ON hms_platform_leads;
CREATE POLICY "Super admin can manage leads"
  ON hms_platform_leads FOR SELECT
  USING (hms_is_super_admin());

DROP POLICY IF EXISTS "Super admin can update leads" ON hms_platform_leads;
CREATE POLICY "Super admin can update leads"
  ON hms_platform_leads FOR UPDATE
  USING (hms_is_super_admin())
  WITH CHECK (hms_is_super_admin());

DROP POLICY IF EXISTS "Super admin can delete leads" ON hms_platform_leads;
CREATE POLICY "Super admin can delete leads"
  ON hms_platform_leads FOR DELETE
  USING (hms_is_super_admin());

DROP POLICY IF EXISTS "Super admin can view all applications" ON hms_tenant_applications;
CREATE POLICY "Super admin can view all applications"
  ON hms_tenant_applications FOR SELECT
  USING (hms_is_super_admin());

-- ============================================================
-- F-006 FIX: Include junction-table branch owners in
-- hms_partnerships ALL policy so branch owners can manage
-- partnerships via the Supabase client (not just admin client).
-- ============================================================

DROP POLICY IF EXISTS "Hostel owner can manage partnerships" ON hms_partnerships;

CREATE POLICY "Hostel owner can manage partnerships"
  ON hms_partnerships FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM hms_hostels h
      WHERE h.id = hostel_id
        AND h.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM hms_owner_hostels oh
      WHERE oh.hostel_id = hostel_id
        AND oh.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM hms_hostels h
      WHERE h.id = hostel_id
        AND h.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM hms_owner_hostels oh
      WHERE oh.hostel_id = hostel_id
        AND oh.owner_id = auth.uid()
    )
  );

-- ============================================================
-- F-007 FIX: Include junction-table branch owners in
-- hms_invoice_links INSERT policy so branch owners can create
-- invoice links via createInvoiceLink() server action.
-- ============================================================

DROP POLICY IF EXISTS "Owner can create invoice links for own hostel" ON hms_invoice_links;

CREATE POLICY "Owner can create invoice links for own hostel"
  ON hms_invoice_links FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM hms_hostels h
      WHERE h.id = hostel_id
        AND h.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM hms_owner_hostels oh
      WHERE oh.hostel_id = hostel_id
        AND oh.owner_id = auth.uid()
    )
  );

-- ============================================================
-- F-005 FIX: DB-level rate limiting for public INSERT endpoints.
-- Reject application inserts from the same phone number if more
-- than 3 have been submitted in the last 24 hours.
-- ============================================================

CREATE OR REPLACE FUNCTION hms_check_application_rate_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (
    SELECT COUNT(*) FROM hms_tenant_applications
    WHERE phone = NEW.phone
      AND applied_at > now() - interval '24 hours'
  ) >= 3 THEN
    RAISE EXCEPTION 'Rate limit exceeded: too many applications from this phone number';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS hms_application_rate_limit ON hms_tenant_applications;

CREATE TRIGGER hms_application_rate_limit
  BEFORE INSERT ON hms_tenant_applications
  FOR EACH ROW
  EXECUTE FUNCTION hms_check_application_rate_limit();
