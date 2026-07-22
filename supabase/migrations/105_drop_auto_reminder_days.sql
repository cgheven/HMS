-- Reminder timing is no longer a hostel-wide configured day list — it's now
-- derived automatically per tenant from their own check_in day-of-month
-- (a real per-tenant due date, since 20 tenants in one hostel can each have
-- joined on a different day). auto_reminder_enabled (the Super Admin grant)
-- is the only lever left; the owner has nothing to configure.
alter table hms_hostels
  drop column if exists auto_reminder_days;
