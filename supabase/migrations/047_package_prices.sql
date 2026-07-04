-- Migration 047: Add per-package price configuration to hms_package_configs
--
-- Stores two price points per package tier (standard room / AC room).
-- These represent the monthly_rent (space component) that gets stored on the
-- tenant when a package is selected. Food and AC charges are still added
-- automatically by the billing trigger (migration 038).

ALTER TABLE hms_package_configs
  ADD COLUMN IF NOT EXISTS package_prices JSONB NOT NULL DEFAULT '{}'::jsonb;
