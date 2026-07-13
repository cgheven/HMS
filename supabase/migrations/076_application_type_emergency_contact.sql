-- Add tenant "Type" and emergency contact fields to the public application
-- form, mirroring hms_tenants so this info survives conversion into a tenant
-- instead of being re-entered by the owner after approval.
ALTER TABLE hms_tenant_applications
  ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'general'
    CHECK (type IN ('student', 'professional', 'general')),
  ADD COLUMN IF NOT EXISTS emergency_contact TEXT,
  ADD COLUMN IF NOT EXISTS emergency_phone TEXT,
  ADD COLUMN IF NOT EXISTS emergency_relationship TEXT;
