-- Widens hms_manager_permissions_permission_check to allow four new manager
-- permissions: edit_members, edit_expenses, edit_kitchen_expenses, and
-- manage_rooms (add + edit rooms). Managers in Pakistan typically run the
-- full day-to-day operation, so owners can now optionally grant edit/update
-- capability on top of the existing add-only permissions. Delete remains
-- owner/full-partner-only everywhere — no delete permission is introduced.

ALTER TABLE hms_manager_permissions
  DROP CONSTRAINT IF EXISTS hms_manager_permissions_permission_check;

ALTER TABLE hms_manager_permissions
  ADD CONSTRAINT hms_manager_permissions_permission_check
  CHECK (permission IN (
    'add_members', 'collect_payments', 'add_expenses', 'add_kitchen_expenses',
    'edit_members', 'edit_expenses', 'edit_kitchen_expenses', 'manage_rooms'
  ));
