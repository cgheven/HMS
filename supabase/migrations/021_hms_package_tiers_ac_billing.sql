-- Migration 021: Package tiers (space_only / space_food / space_food_ac) and AC billing
-- Adds package_tier to tenants, food/AC charge columns to payments,
-- and a per-hostel package config table.

-- a) Tenant package tier
alter table hms_tenants
  add column if not exists package_tier text not null default 'space_only'
    check (package_tier in ('space_only', 'space_food', 'space_food_ac'));

-- b) Food charge on payments
alter table hms_payments
  add column if not exists food_charge numeric(10,2) not null default 0
    check (food_charge >= 0);

-- c) AC units consumed on payments
alter table hms_payments
  add column if not exists ac_units_consumed integer not null default 0
    check (ac_units_consumed >= 0);

-- d) AC charge on payments
alter table hms_payments
  add column if not exists ac_charge numeric(10,2) not null default 0
    check (ac_charge >= 0);

-- e) Snapshot of tenant package tier at billing time
alter table hms_payments
  add column if not exists payment_package_tier text default 'space_only';

-- f) Per-hostel package configuration table
create table if not exists hms_package_configs (
  id                uuid        default gen_random_uuid() primary key,
  hostel_id         uuid        not null unique references hms_hostels(id) on delete cascade,
  food_monthly_rate numeric(10,2) not null default 0 check (food_monthly_rate >= 0),
  ac_per_unit_rate  numeric(10,2) not null default 0 check (ac_per_unit_rate >= 0),
  created_at        timestamptz default now() not null,
  updated_at        timestamptz default now() not null
);

-- auto-update updated_at
create trigger hms_package_configs_updated_at
  before update on hms_package_configs
  for each row execute procedure hms_set_updated_at();

-- g) RLS
alter table hms_package_configs enable row level security;

-- Any authenticated user can read the config for a hostel they own
create policy "Owner can view own package config"
  on hms_package_configs for select
  using (
    exists (
      select 1 from hms_hostels
      where hms_hostels.id = hms_package_configs.hostel_id
        and hms_hostels.owner_id = auth.uid()
    )
  );

-- Owner can insert their hostel's config
create policy "Owner can insert own package config"
  on hms_package_configs for insert
  with check (
    exists (
      select 1 from hms_hostels
      where hms_hostels.id = hms_package_configs.hostel_id
        and hms_hostels.owner_id = auth.uid()
    )
  );

-- Owner can update their hostel's config
create policy "Owner can update own package config"
  on hms_package_configs for update
  using (
    exists (
      select 1 from hms_hostels
      where hms_hostels.id = hms_package_configs.hostel_id
        and hms_hostels.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from hms_hostels
      where hms_hostels.id = hms_package_configs.hostel_id
        and hms_hostels.owner_id = auth.uid()
    )
  );

-- Owner can delete their hostel's config
create policy "Owner can delete own package config"
  on hms_package_configs for delete
  using (
    exists (
      select 1 from hms_hostels
      where hms_hostels.id = hms_package_configs.hostel_id
        and hms_hostels.owner_id = auth.uid()
    )
  );

-- h) Index
create index if not exists idx_hms_package_configs_hostel_id
  on hms_package_configs(hostel_id);
