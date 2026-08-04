-- Email delivery tracking for platform invoices.
--
-- Invoices have been generated automatically by /api/cron/generate-invoices
-- since migration 085, but nothing ever told the client — collection was
-- chased by hand over WhatsApp. All five billing clients are currently sitting
-- on unpaid invoices, two of them already past due.
--
-- first_sent_at is set by the manual "Send invoice" button in the SuperAdmin
-- billing panel and is what arms the reminder job: an invoice that has never
-- been sent is never chased, so generating an invoice can't email anyone by
-- itself. Reminders then go out every 3 days until the invoice leaves 'unpaid'.

ALTER TABLE hms_platform_invoices ADD COLUMN IF NOT EXISTS first_sent_at    timestamptz;
ALTER TABLE hms_platform_invoices ADD COLUMN IF NOT EXISTS last_reminder_at timestamptz;
ALTER TABLE hms_platform_invoices ADD COLUMN IF NOT EXISTS reminder_count   integer NOT NULL DEFAULT 0;

-- The reminder job scans for unpaid + already-sent invoices only; this keeps
-- that scan off a full table scan as invoice history grows.
CREATE INDEX IF NOT EXISTS idx_hms_platform_invoices_reminder_due
  ON hms_platform_invoices (status, first_sent_at)
  WHERE status = 'unpaid' AND first_sent_at IS NOT NULL;
