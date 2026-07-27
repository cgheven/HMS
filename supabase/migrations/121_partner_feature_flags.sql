-- Per-partner, per-hostel opt-in custom feature flags (e.g. daily expense
-- breakdown on Dashboard, requested by one client for a family member's view).
-- Purely additive: default '{}' means every existing row is unaffected.
alter table hms_partnerships
  add column if not exists feature_flags jsonb not null default '{}'::jsonb;
