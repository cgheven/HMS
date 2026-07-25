-- Tenant welcome WhatsApp message (multi-network WiFi + mess-menu link) and
-- the tenant-leaving-to-owner reminder. Both extend the single
-- whatsapp_enabled gate (migration 110) — no new flags.

alter table hms_hostels
  add column if not exists wifi_networks jsonb not null default '[]',
  add column if not exists welcome_message_template text;

alter table hms_tenants
  add column if not exists leaving_reminder_sent_at timestamptz;

-- Dedup guard lookup for the leaving-reminder cron — partial index stays
-- tiny since only tenants currently mid-notice ever match.
create index if not exists idx_hms_tenants_leaving_reminder_pending
  on hms_tenants (intended_checkout_date)
  where intended_checkout_date is not null and leaving_reminder_sent_at is null;
