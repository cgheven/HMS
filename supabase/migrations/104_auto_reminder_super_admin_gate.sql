-- Auto WhatsApp reminders are a curated feature, not self-service — a hostel
-- must be explicitly granted access by Super Admin before its own
-- auto_reminder_days (set by the owner in Settings) has any effect. Defaults
-- to false for every existing and new hostel, so nothing changes for anyone
-- until Super Admin turns it on for that specific branch.
alter table hms_hostels
  add column if not exists auto_reminder_enabled boolean not null default false;
