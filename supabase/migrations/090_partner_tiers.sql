-- Adds a per-branch permission tier to hms_partnerships. Existing rows default
-- to 'read_only' — exactly the behavior every partner has today — so this is
-- non-breaking. hms_partnerships is already one row per (hostel_id, partner_id),
-- so no new table is needed for per-branch tiers.

alter table hms_partnerships
  add column if not exists tier text not null default 'read_only'
    check (tier in ('read_only', 'standard', 'full'));

comment on column hms_partnerships.tier is
  'Per-branch access tier for this partner on this hostel: read_only (view only), standard (day-to-day ops: tenants/payments/expenses), full (equal to owner, incl. checkout/edit).';
