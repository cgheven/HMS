-- Make the per-tenant sync record legible and support background syncing.
--
-- hotel_eye_status already holds not_synced / synced / failed. Two additions:
--   * a 'queued' status value (no schema change — the column is free text) meaning
--     "picked for a background run, not filed yet", so the page can show "Syncing…"
--     after the browser has been closed and reopened;
--   * last_error / last_attempt_at, so a failed row says WHY and WHEN instead of a
--     bare red badge, and the record is auditable per tenant.

alter table public.hms_tenants
  add column if not exists hotel_eye_last_error text,
  add column if not exists hotel_eye_last_attempt_at timestamptz;
