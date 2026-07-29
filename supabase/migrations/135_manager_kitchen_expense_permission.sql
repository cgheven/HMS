-- Widen hms_manager_permissions.permission to also allow 'add_kitchen_expenses'.
--
-- Mirrors 'add_expenses' exactly: an optional, owner-toggled, per-manager
-- permission that gates add-only access to kitchen expenses from the manager
-- portal (managers never get edit/delete, same as add_expenses today).
--
-- Migration 051_manager_roles.sql created the column with an inline CHECK
-- and no explicit constraint name, so Postgres auto-named it
-- hms_manager_permissions_permission_check. Pure widening of an
-- already-permissive CHECK on a small table (few rows) — additive, no data
-- rewrite needed.

ALTER TABLE hms_manager_permissions
  DROP CONSTRAINT IF EXISTS hms_manager_permissions_permission_check;

ALTER TABLE hms_manager_permissions
  ADD CONSTRAINT hms_manager_permissions_permission_check
  CHECK (permission IN ('add_members', 'collect_payments', 'add_expenses', 'add_kitchen_expenses'));
