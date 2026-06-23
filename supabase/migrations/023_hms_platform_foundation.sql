-- Migration 023: HMS Platform Foundation
-- Adds multi-role profiles, owner-hostel junction, partnerships,
-- platform leads, invoice links, tenant applications, and supporting schema changes.

-- ============================================================
-- 1. hms_profiles — add new columns to existing table
-- ============================================================
ALTER TABLE hms_profiles
  ADD COLUMN IF NOT EXISTS role              text        NOT NULL DEFAULT 'owner'
                                             CHECK (role IN ('super_admin', 'owner', 'partner')),
  ADD COLUMN IF NOT EXISTS phone             text,
  ADD COLUMN IF NOT EXISTS primary_hostel_id uuid        REFERENCES hms_hostels(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_active         boolean     NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS updated_at        timestamptz NOT NULL DEFAULT now();

-- updated_at trigger for hms_profiles
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'hms_profiles_updated_at'
      AND tgrelid = 'hms_profiles'::regclass
  ) THEN
    CREATE TRIGGER hms_profiles_updated_at
      BEFORE UPDATE ON hms_profiles
      FOR EACH ROW EXECUTE FUNCTION hms_set_updated_at();
  END IF;
END $$;

-- Function: auto-create profile row on new auth.users insert
CREATE OR REPLACE FUNCTION hms_handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO hms_profiles (id, role, full_name, phone)
  VALUES (
    NEW.id,
    'owner',
    COALESCE(NEW.raw_user_meta_data->>'full_name', NULL),
    COALESCE(NEW.raw_user_meta_data->>'phone', NULL)
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Trigger: fire hms_handle_new_user after each auth.users insert
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'hms_on_new_user_create_profile'
      AND tgrelid = 'auth.users'::regclass
  ) THEN
    CREATE TRIGGER hms_on_new_user_create_profile
      AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION hms_handle_new_user();
  END IF;
END $$;

-- Backfill: create profile rows for any existing auth.users without one
INSERT INTO hms_profiles (id, role, full_name)
SELECT
  u.id,
  'owner',
  u.raw_user_meta_data->>'full_name'
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM hms_profiles p WHERE p.id = u.id)
ON CONFLICT (id) DO NOTHING;

-- RLS for hms_profiles
ALTER TABLE hms_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "User can view own profile" ON hms_profiles;
CREATE POLICY "User can view own profile"
  ON hms_profiles FOR SELECT
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "User can update own profile" ON hms_profiles;
CREATE POLICY "User can update own profile"
  ON hms_profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Super admin can view all profiles" ON hms_profiles;
CREATE POLICY "Super admin can view all profiles"
  ON hms_profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM hms_profiles sp
      WHERE sp.id = auth.uid()
        AND sp.role = 'super_admin'
    )
  );

-- ============================================================
-- 2. hms_owner_hostels  (junction: owner <-> hostel)
-- ============================================================
CREATE TABLE IF NOT EXISTS hms_owner_hostels (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   uuid        NOT NULL REFERENCES hms_profiles(id) ON DELETE CASCADE,
  hostel_id  uuid        NOT NULL REFERENCES hms_hostels(id)  ON DELETE CASCADE,
  is_primary boolean     NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, hostel_id)
);

CREATE INDEX IF NOT EXISTS idx_hms_owner_hostels_owner_id
  ON hms_owner_hostels(owner_id);

CREATE INDEX IF NOT EXISTS idx_hms_owner_hostels_hostel_id
  ON hms_owner_hostels(hostel_id);

-- Data migration: seed junction from existing hms_hostels.owner_id
INSERT INTO hms_owner_hostels (owner_id, hostel_id, is_primary)
SELECT owner_id, id, true
FROM hms_hostels
ON CONFLICT (owner_id, hostel_id) DO NOTHING;

-- RLS for hms_owner_hostels
ALTER TABLE hms_owner_hostels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner sees own junction rows" ON hms_owner_hostels;
CREATE POLICY "Owner sees own junction rows"
  ON hms_owner_hostels FOR SELECT
  USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS "Super admin sees all junction rows" ON hms_owner_hostels;
CREATE POLICY "Super admin sees all junction rows"
  ON hms_owner_hostels FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM hms_profiles sp
      WHERE sp.id = auth.uid()
        AND sp.role = 'super_admin'
    )
  );

-- ============================================================
-- 3. hms_partnerships
-- ============================================================
CREATE TABLE IF NOT EXISTS hms_partnerships (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  hostel_id  uuid        NOT NULL REFERENCES hms_hostels(id)  ON DELETE CASCADE,
  partner_id uuid        NOT NULL REFERENCES hms_profiles(id) ON DELETE CASCADE,
  created_by uuid        REFERENCES hms_profiles(id),
  is_active  boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hostel_id, partner_id)
);

CREATE INDEX IF NOT EXISTS idx_hms_partnerships_hostel_id
  ON hms_partnerships(hostel_id);

CREATE INDEX IF NOT EXISTS idx_hms_partnerships_partner_id
  ON hms_partnerships(partner_id);

-- RLS for hms_partnerships
ALTER TABLE hms_partnerships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Hostel owner can manage partnerships" ON hms_partnerships;
CREATE POLICY "Hostel owner can manage partnerships"
  ON hms_partnerships FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM hms_hostels h
      WHERE h.id = hostel_id
        AND h.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM hms_hostels h
      WHERE h.id = hostel_id
        AND h.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Partner can view own partnerships" ON hms_partnerships;
CREATE POLICY "Partner can view own partnerships"
  ON hms_partnerships FOR SELECT
  USING (auth.uid() = partner_id);

DROP POLICY IF EXISTS "Super admin can view all partnerships" ON hms_partnerships;
CREATE POLICY "Super admin can view all partnerships"
  ON hms_partnerships FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM hms_profiles sp
      WHERE sp.id = auth.uid()
        AND sp.role = 'super_admin'
    )
  );

-- ============================================================
-- 4. hms_platform_leads
-- ============================================================
CREATE TABLE IF NOT EXISTS hms_platform_leads (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name        text        NOT NULL,
  owner_name           text        NOT NULL,
  phone                text        NOT NULL,
  email                text,
  city                 text,
  branch_count         integer     NOT NULL DEFAULT 1,
  notes                text,
  status               text        NOT NULL DEFAULT 'new'
                                   CHECK (status IN ('new', 'contacted', 'converted', 'rejected')),
  converted_hostel_id  uuid        REFERENCES hms_hostels(id),
  ip_address           text,
  created_at           timestamptz NOT NULL DEFAULT now()
);

-- RLS for hms_platform_leads
ALTER TABLE hms_platform_leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can submit a lead" ON hms_platform_leads;
CREATE POLICY "Anyone can submit a lead"
  ON hms_platform_leads FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "Super admin can manage leads" ON hms_platform_leads;
CREATE POLICY "Super admin can manage leads"
  ON hms_platform_leads FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM hms_profiles sp
      WHERE sp.id = auth.uid()
        AND sp.role = 'super_admin'
    )
  );

DROP POLICY IF EXISTS "Super admin can update leads" ON hms_platform_leads;
CREATE POLICY "Super admin can update leads"
  ON hms_platform_leads FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM hms_profiles sp
      WHERE sp.id = auth.uid()
        AND sp.role = 'super_admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM hms_profiles sp
      WHERE sp.id = auth.uid()
        AND sp.role = 'super_admin'
    )
  );

DROP POLICY IF EXISTS "Super admin can delete leads" ON hms_platform_leads;
CREATE POLICY "Super admin can delete leads"
  ON hms_platform_leads FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM hms_profiles sp
      WHERE sp.id = auth.uid()
        AND sp.role = 'super_admin'
    )
  );

-- ============================================================
-- 5. hms_invoice_links
-- ============================================================
CREATE TABLE IF NOT EXISTS hms_invoice_links (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  token      text        NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  payment_id uuid        REFERENCES hms_payments(id) ON DELETE CASCADE,
  hostel_id  uuid        REFERENCES hms_hostels(id)  ON DELETE CASCADE,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hms_invoice_links_token
  ON hms_invoice_links(token);

CREATE INDEX IF NOT EXISTS idx_hms_invoice_links_hostel_id
  ON hms_invoice_links(hostel_id);

-- RLS for hms_invoice_links
ALTER TABLE hms_invoice_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner can create invoice links for own hostel" ON hms_invoice_links;
CREATE POLICY "Owner can create invoice links for own hostel"
  ON hms_invoice_links FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM hms_hostels h
      WHERE h.id = hostel_id
        AND h.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Anyone can read unexpired invoice links" ON hms_invoice_links;
CREATE POLICY "Anyone can read unexpired invoice links"
  ON hms_invoice_links FOR SELECT
  USING (expires_at > now());

-- ============================================================
-- 6. hms_tenant_applications
-- ============================================================
CREATE TABLE IF NOT EXISTS hms_tenant_applications (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  hostel_id       uuid        NOT NULL REFERENCES hms_hostels(id) ON DELETE CASCADE,
  full_name       text        NOT NULL,
  phone           text        NOT NULL,
  email           text,
  cnic            text,
  room_preference text,
  package_tier    text        NOT NULL DEFAULT 'space_only'
                              CHECK (package_tier IN ('space_only', 'space_food', 'space_food_ac')),
  move_in_date    date,
  notes           text,
  photo_url       text,
  status          text        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'approved', 'rejected')),
  applied_at      timestamptz NOT NULL DEFAULT now(),
  reviewed_at     timestamptz,
  reviewed_by     uuid        REFERENCES hms_profiles(id)
);

CREATE INDEX IF NOT EXISTS idx_hms_tenant_applications_hostel_id
  ON hms_tenant_applications(hostel_id);

CREATE INDEX IF NOT EXISTS idx_hms_tenant_applications_status
  ON hms_tenant_applications(status);

-- RLS for hms_tenant_applications
ALTER TABLE hms_tenant_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can submit a tenant application" ON hms_tenant_applications;
CREATE POLICY "Anyone can submit a tenant application"
  ON hms_tenant_applications FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "Owner can manage own hostel applications" ON hms_tenant_applications;
CREATE POLICY "Owner can manage own hostel applications"
  ON hms_tenant_applications FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM hms_hostels h
      WHERE h.id = hostel_id
        AND h.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM hms_owner_hostels oh
      WHERE oh.hostel_id = hms_tenant_applications.hostel_id
        AND oh.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Owner can update own hostel applications" ON hms_tenant_applications;
CREATE POLICY "Owner can update own hostel applications"
  ON hms_tenant_applications FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM hms_hostels h
      WHERE h.id = hostel_id
        AND h.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM hms_owner_hostels oh
      WHERE oh.hostel_id = hms_tenant_applications.hostel_id
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
      WHERE oh.hostel_id = hms_tenant_applications.hostel_id
        AND oh.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Super admin can view all applications" ON hms_tenant_applications;
CREATE POLICY "Super admin can view all applications"
  ON hms_tenant_applications FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM hms_profiles sp
      WHERE sp.id = auth.uid()
        AND sp.role = 'super_admin'
    )
  );

-- ============================================================
-- 7. hms_hostels: add slug column and backfill
-- ============================================================
ALTER TABLE hms_hostels
  ADD COLUMN IF NOT EXISTS slug text UNIQUE;

UPDATE hms_hostels
SET slug = lower(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g'))
           || '-' || substr(id::text, 1, 6)
WHERE slug IS NULL;

-- ============================================================
-- 8. hms_tenants: add photo_url column
-- ============================================================
ALTER TABLE hms_tenants
  ADD COLUMN IF NOT EXISTS photo_url text;
