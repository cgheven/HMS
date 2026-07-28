-- Foundational data collection for a future roommate-matching platform:
-- students match by institute + department, professionals match by
-- organization + department. Purely additive/opt-in — every existing tenant
-- and application defaults to NULL, so nothing changes until an owner
-- enables these fields (Settings) or a tenant is added/edited going forward.

ALTER TABLE hms_tenants
  ADD COLUMN IF NOT EXISTS institute_name text,
  ADD COLUMN IF NOT EXISTS organization text,
  ADD COLUMN IF NOT EXISTS organization_type text
    CHECK (organization_type IS NULL OR organization_type IN ('private', 'government')),
  ADD COLUMN IF NOT EXISTS department text;

ALTER TABLE hms_tenant_applications
  ADD COLUMN IF NOT EXISTS institute_name text,
  ADD COLUMN IF NOT EXISTS organization text,
  ADD COLUMN IF NOT EXISTS organization_type text
    CHECK (organization_type IS NULL OR organization_type IN ('private', 'government')),
  ADD COLUMN IF NOT EXISTS department text;
