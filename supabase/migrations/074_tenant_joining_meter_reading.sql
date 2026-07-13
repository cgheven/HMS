-- Captures the room's AC meter reading at the moment a tenant moves in — a
-- one-time factual snapshot for the tenant's own records, printed on their
-- receipt so there's no future dispute about what the meter read before they
-- arrived. Distinct from hms_room_ac_join_readings (046), which stores a
-- relative unit offset used purely for the mid-month billing-split algorithm.
ALTER TABLE hms_tenants
  ADD COLUMN IF NOT EXISTS joining_meter_reading NUMERIC(10, 2);
