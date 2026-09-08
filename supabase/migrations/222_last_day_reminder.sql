-- Dedup guard for the resident-facing "today is your last day" reminder, sent by
-- the daily leaving-reminders cron on a tenant's intended_checkout_date. Separate
-- from leaving_reminder_sent_at (which guards the OWNER's 7-days-out reminder):
-- the two fire on different days for different recipients. Reset to null whenever
-- the notice/checkout date changes so a rescheduled leave re-arms the reminder.

alter table public.hms_tenants
  add column if not exists last_day_reminder_sent_at timestamptz;
