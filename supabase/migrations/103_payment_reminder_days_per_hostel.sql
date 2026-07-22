-- Auto payment-reminder days are per-hostel, not a single global day — each
-- owner/branch picks their own day(s) of the month. NULL/empty means the
-- feature is off for that hostel (opt-in, same convention as monthly_rate
-- being null meaning "billing not configured").
alter table hms_hostels
  add column if not exists auto_reminder_days smallint[];
