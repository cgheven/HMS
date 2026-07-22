-- Tracks the last time the automated Wasender reminder cron messaged this
-- payment's tenant, so the cron never double-sends within the same day even
-- if it retries. Fully separate from the existing manual wa.me "Send
-- Reminder" button, which does not read or write this column.
alter table hms_payments
  add column if not exists last_reminder_sent_at timestamptz;
