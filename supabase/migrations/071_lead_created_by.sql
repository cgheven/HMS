-- Tracks who manually logged a lead (SuperAdmin or a sales rep, via createLead()).
-- NULL means either the public onboarding form (app/actions/onboarding.ts) or a
-- lead created before this column existed. Powers the "My Leads" segregation on
-- the SuperAdmin leads page — distinct from assigned_to, which tracks who's
-- currently responsible for following up (that can move to a rep after creation).
ALTER TABLE hms_platform_leads
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_hms_platform_leads_created_by ON hms_platform_leads (created_by);
