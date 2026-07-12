-- Manual lead prioritization (low/medium/high) so admins and sales reps can
-- triage which leads to work first, independent of pipeline stage or follow-up date.
ALTER TABLE hms_platform_leads
  ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('low', 'medium', 'high'));

CREATE INDEX IF NOT EXISTS idx_hms_platform_leads_priority ON hms_platform_leads (priority);
