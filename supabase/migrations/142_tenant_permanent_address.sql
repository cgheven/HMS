-- Permanent (home) address for a tenant — the address they return to, as
-- distinct from the hostel room they occupy. Collected on the public admission
-- form and on the owner's own Add Tenant dialog so both entry points capture
-- the same record; carried across when an application is approved.
--
-- Purely additive and nullable: every existing tenant and application keeps
-- working untouched, and the field only appears on a form once the branch
-- enables it (hms_hostels.form_config, default enabled + optional).

ALTER TABLE hms_tenants
  ADD COLUMN IF NOT EXISTS permanent_address text;

ALTER TABLE hms_tenant_applications
  ADD COLUMN IF NOT EXISTS permanent_address text;

COMMENT ON COLUMN hms_tenants.permanent_address IS
  'Tenant home/permanent address. Free text, nullable. Distinct from the hostel address on hms_hostels.';

COMMENT ON COLUMN hms_tenant_applications.permanent_address IS
  'Applicant home/permanent address, copied to hms_tenants.permanent_address on approval.';
