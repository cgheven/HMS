-- Migration 029: Per-tenant document storage for police verification
ALTER TABLE hms_tenants
  ADD COLUMN IF NOT EXISTS documents jsonb NOT NULL DEFAULT '[]'::jsonb;
