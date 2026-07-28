-- Per-tenant vehicle record — a name/plate/model on file for safety
-- verification and to resolve parking disputes ("whose car is this").
-- Purely additive, nullable, no billing/trigger involvement — a tenant
-- with no vehicle is simply left with all three columns NULL.

ALTER TABLE hms_tenants
  ADD COLUMN IF NOT EXISTS vehicle_type text;
ALTER TABLE hms_tenants
  ADD COLUMN IF NOT EXISTS vehicle_number text;
ALTER TABLE hms_tenants
  ADD COLUMN IF NOT EXISTS vehicle_model text;

comment on column hms_tenants.vehicle_type is
  'Free text, e.g. Car / Motorcycle / Bicycle. NULL = no vehicle on file.';
comment on column hms_tenants.vehicle_number is
  'Registration/plate number — the identifying field for safety checks and parking disputes.';
comment on column hms_tenants.vehicle_model is
  'Optional make/model detail, e.g. "Honda CD 70".';

-- Plate numbers need to be found quickly across the whole hostel when
-- resolving a parking conflict, not just looked up per-tenant.
create index if not exists idx_hms_tenants_vehicle_number
  on hms_tenants (hostel_id, vehicle_number)
  where vehicle_number is not null;
