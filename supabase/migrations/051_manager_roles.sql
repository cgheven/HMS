CREATE TABLE IF NOT EXISTS hms_managers (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name             TEXT        NOT NULL CHECK (char_length(trim(name)) >= 2),
  phone            TEXT        NOT NULL UNIQUE CHECK (phone ~ '^\d{7,15}$'),
  supabase_user_id UUID        UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  has_login        BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hms_manager_hostels (
  manager_id UUID NOT NULL REFERENCES hms_managers(id) ON DELETE CASCADE,
  hostel_id  UUID NOT NULL REFERENCES hms_hostels(id)  ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (manager_id, hostel_id)
);

CREATE TABLE IF NOT EXISTS hms_manager_permissions (
  manager_id UUID NOT NULL REFERENCES hms_managers(id) ON DELETE CASCADE,
  permission TEXT NOT NULL CHECK (permission IN ('add_members', 'collect_payments', 'add_expenses')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (manager_id, permission)
);

-- Enable RLS with default-deny for client SDK users.
-- All server code uses the service role (createAdminClient) which bypasses RLS entirely.
ALTER TABLE hms_managers            ENABLE ROW LEVEL SECURITY;
ALTER TABLE hms_manager_hostels     ENABLE ROW LEVEL SECURITY;
ALTER TABLE hms_manager_permissions ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION hms_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

CREATE TRIGGER hms_managers_updated_at
  BEFORE UPDATE ON hms_managers
  FOR EACH ROW EXECUTE FUNCTION hms_set_updated_at();

CREATE INDEX idx_hms_managers_owner
  ON hms_managers (owner_id);

CREATE INDEX idx_hms_manager_hostels_hostel
  ON hms_manager_hostels (hostel_id);

CREATE INDEX idx_hms_manager_permissions_staff
  ON hms_manager_permissions (manager_id);
