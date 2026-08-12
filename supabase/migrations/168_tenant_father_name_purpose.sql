-- Father's name and purpose of visit — two admission-register fields hostels
-- are routinely asked for and currently have nowhere to record.
--
-- Purpose of visit is NOT a duplicate of hms_tenants.type. `type` says what a
-- person IS (student / professional / general); this says why they are in the
-- city. A professional here for a two-week exam and a professional here for a
-- permanent job are the same `type` and completely different residents.
--
-- Follows migration 142 (permanent_address) exactly: additive, nullable, on
-- BOTH the application and the tenant so the public form and the owner's own
-- Add Tenant dialog capture the same record, and the value carries across on
-- approval. Every existing tenant and application keeps working untouched, and
-- the fields only appear on a form once the branch enables them
-- (hms_hostels.form_config — default enabled + optional, so no branch's live
-- admission form starts rejecting submissions the moment this ships).

SET lock_timeout = '3s';

-- ── Father's name ──────────────────────────────────────────────────────────
ALTER TABLE public.hms_tenants
  ADD COLUMN IF NOT EXISTS father_name text;

ALTER TABLE public.hms_tenant_applications
  ADD COLUMN IF NOT EXISTS father_name text;

COMMENT ON COLUMN public.hms_tenants.father_name IS
  'Tenant''s father name. Free text, nullable. Admission-register field, never used for billing or auth.';

COMMENT ON COLUMN public.hms_tenant_applications.father_name IS
  'Applicant''s father name, copied to hms_tenants.father_name on approval.';

-- ── Purpose of visit ───────────────────────────────────────────────────────
-- Constrained key + free-text companion, the same pair migration 128
-- established for student_category/student_specialization: the key stays
-- filterable and chartable, and `_detail` carries whatever was typed under
-- "Other" so an unusual case is never forced into a wrong bucket.
--
-- DROP then ADD rather than a bare ADD with an inline CHECK: ADD COLUMN IF NOT
-- EXISTS silently skips its CHECK when the column already exists, so a re-run
-- would leave the constraint missing. Naming it makes the state explicit.
ALTER TABLE public.hms_tenants
  ADD COLUMN IF NOT EXISTS purpose_of_visit text,
  ADD COLUMN IF NOT EXISTS purpose_of_visit_detail text;

ALTER TABLE public.hms_tenants
  DROP CONSTRAINT IF EXISTS hms_tenants_purpose_of_visit_valid;
ALTER TABLE public.hms_tenants
  ADD CONSTRAINT hms_tenants_purpose_of_visit_valid CHECK (
    purpose_of_visit IS NULL OR purpose_of_visit IN (
      'education', 'employment', 'job_interview', 'exam',
      'medical', 'business', 'tourism', 'other'
    )
  );

ALTER TABLE public.hms_tenant_applications
  ADD COLUMN IF NOT EXISTS purpose_of_visit text,
  ADD COLUMN IF NOT EXISTS purpose_of_visit_detail text;

ALTER TABLE public.hms_tenant_applications
  DROP CONSTRAINT IF EXISTS hms_tenant_applications_purpose_of_visit_valid;
ALTER TABLE public.hms_tenant_applications
  ADD CONSTRAINT hms_tenant_applications_purpose_of_visit_valid CHECK (
    purpose_of_visit IS NULL OR purpose_of_visit IN (
      'education', 'employment', 'job_interview', 'exam',
      'medical', 'business', 'tourism', 'other'
    )
  );

COMMENT ON COLUMN public.hms_tenants.purpose_of_visit IS
  'Why the resident is in the city — one of education/employment/job_interview/exam/medical/business/tourism/other. Distinct from `type`, which is what they are. NULL = not collected.';

COMMENT ON COLUMN public.hms_tenants.purpose_of_visit_detail IS
  'Free text, only meaningful when purpose_of_visit = ''other''. See lib/visit-purpose.ts visitPurposeLabel().';

COMMENT ON COLUMN public.hms_tenant_applications.purpose_of_visit IS
  'Applicant purpose of visit, copied to hms_tenants.purpose_of_visit on approval.';

COMMENT ON COLUMN public.hms_tenant_applications.purpose_of_visit_detail IS
  'Applicant free-text purpose, copied to hms_tenants.purpose_of_visit_detail on approval.';
