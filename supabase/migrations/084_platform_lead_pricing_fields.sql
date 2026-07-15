-- Additive: capture hostel type + how-they-heard-about-us on the public onboarding
-- form, and the annual price quoted at submission time (so it's on record even if
-- pricing changes later).
alter table hms_platform_leads
  add column if not exists hostel_type text,
  add column if not exists quoted_annual_price numeric(12, 2);

alter table hms_platform_leads
  add constraint hms_platform_leads_hostel_type_check
  check (hostel_type is null or hostel_type in ('boys', 'girls', 'mixed', 'family'));
