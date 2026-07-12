-- Sales CRM: B2B lead pipeline (contact -> follow-up -> demo -> onboarding -> converted),
-- a separate sales-rep identity/login (mirrors hms_managers), an append-only activity log
-- (calls/visits/demos/notes) per lead, and per-rep daily/weekly targets.
--
-- Extends the existing hms_platform_leads table (SuperAdmin > Client Leads) rather than
-- introducing a competing lead table. hms_prospects / hms_inquiries are legacy and untouched.

-- ── hms_sales_reps ───────────────────────────────────────────────────────────
-- Identity + portal-login table for internal sales staff, mirrors hms_managers:
-- synthetic-email login provisioned by createSalesRepLogin(), never a real hms_profiles.role.
CREATE TABLE IF NOT EXISTS hms_sales_reps (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name             TEXT        NOT NULL CHECK (char_length(trim(name)) >= 2),
  phone            TEXT        NOT NULL UNIQUE CHECK (phone ~ '^\d{7,15}$'),
  supabase_user_id UUID        UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  has_login        BOOLEAN     NOT NULL DEFAULT FALSE,
  is_active        BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER hms_sales_reps_updated_at
  BEFORE UPDATE ON hms_sales_reps
  FOR EACH ROW EXECUTE FUNCTION hms_set_updated_at();

CREATE INDEX idx_hms_sales_reps_created_by ON hms_sales_reps (created_by);

-- ── hms_platform_leads: pipeline + assignment ───────────────────────────────
ALTER TABLE hms_platform_leads
  ADD COLUMN IF NOT EXISTS assigned_to          UUID REFERENCES hms_sales_reps(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source                TEXT,
  ADD COLUMN IF NOT EXISTS next_follow_up_date   DATE,
  ADD COLUMN IF NOT EXISTS updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE hms_platform_leads DROP CONSTRAINT IF EXISTS hms_platform_leads_status_check;
ALTER TABLE hms_platform_leads ADD CONSTRAINT hms_platform_leads_status_check
  CHECK (status IN ('new', 'contacted', 'follow_up', 'demo_scheduled', 'demo_done', 'onboarding', 'converted', 'rejected'));

CREATE TRIGGER hms_platform_leads_updated_at
  BEFORE UPDATE ON hms_platform_leads
  FOR EACH ROW EXECUTE FUNCTION hms_set_updated_at();

CREATE INDEX idx_hms_platform_leads_assigned_to ON hms_platform_leads (assigned_to);

-- ── hms_lead_activities ──────────────────────────────────────────────────────
-- Append-only timeline entry per lead: a call, a visit, a demo, a free-text note,
-- or a status change. This is the "leads cycle" history the SuperAdmin/Sales UIs render,
-- and is also the source of truth for daily/weekly target actuals (counted, not stored).
CREATE TABLE IF NOT EXISTS hms_lead_activities (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id      UUID        NOT NULL REFERENCES hms_platform_leads(id) ON DELETE CASCADE,
  sales_rep_id UUID        REFERENCES hms_sales_reps(id) ON DELETE SET NULL,
  actor_id     UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  type         TEXT        NOT NULL CHECK (type IN ('call', 'visit', 'demo', 'note', 'status_change', 'whatsapp', 'email')),
  outcome      TEXT,
  notes        TEXT,
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_hms_lead_activities_lead ON hms_lead_activities (lead_id, occurred_at DESC);
CREATE INDEX idx_hms_lead_activities_rep_date ON hms_lead_activities (sales_rep_id, occurred_at);

-- ── hms_sales_targets ────────────────────────────────────────────────────────
-- One row per rep holding their current daily/weekly quotas. Actuals are always
-- computed live from hms_lead_activities — no separate progress table to keep in sync.
CREATE TABLE IF NOT EXISTS hms_sales_targets (
  sales_rep_id          UUID        PRIMARY KEY REFERENCES hms_sales_reps(id) ON DELETE CASCADE,
  daily_calls_target    INTEGER     NOT NULL DEFAULT 0 CHECK (daily_calls_target >= 0),
  daily_visits_target   INTEGER     NOT NULL DEFAULT 0 CHECK (daily_visits_target >= 0),
  weekly_calls_target   INTEGER     NOT NULL DEFAULT 0 CHECK (weekly_calls_target >= 0),
  weekly_visits_target  INTEGER     NOT NULL DEFAULT 0 CHECK (weekly_visits_target >= 0),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER hms_sales_targets_updated_at
  BEFORE UPDATE ON hms_sales_targets
  FOR EACH ROW EXECUTE FUNCTION hms_set_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Default-deny for client SDK users, same as hms_managers (051). All server code
-- uses the service role (createAdminClient), which bypasses RLS entirely.
ALTER TABLE hms_sales_reps     ENABLE ROW LEVEL SECURITY;
ALTER TABLE hms_lead_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE hms_sales_targets  ENABLE ROW LEVEL SECURITY;
