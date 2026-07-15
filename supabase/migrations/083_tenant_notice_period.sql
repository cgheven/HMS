-- 083: Tenant notice period tracking.
-- Lets an owner record that a tenant has given notice they're leaving, and
-- reuse that intended date at actual checkout. No penalty/reminder logic —
-- this iteration only tracks the dates and surfaces adequacy vs. the
-- hostel's configured notice period.

alter table hms_package_configs
  add column if not exists notice_period_days integer not null default 30;

alter table hms_tenants
  add column if not exists notice_given_date date,
  add column if not exists intended_checkout_date date;

alter table hms_tenant_events
  drop constraint if exists hms_tenant_events_event_type_check;

alter table hms_tenant_events
  add constraint hms_tenant_events_event_type_check
  check (event_type in (
    'room_changed', 'plan_changed', 'deposit_collected', 'deposit_returned',
    'deposit_forfeited', 'notice_given', 'notice_cancelled'
  ));
