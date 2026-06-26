-- AC billing: per-room monthly electricity readings
-- Total units entered once per room; split equally among active AC-tier tenants

CREATE TABLE IF NOT EXISTS hms_room_ac_readings (
  id             UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  hostel_id      UUID          NOT NULL REFERENCES hms_hostels(id)  ON DELETE CASCADE,
  room_id        UUID          NOT NULL REFERENCES hms_rooms(id)    ON DELETE CASCADE,
  for_month      TEXT          NOT NULL CHECK (for_month ~ '^\d{4}-\d{2}$'),
  total_units    NUMERIC(10,2) NOT NULL CHECK (total_units >= 0),
  per_unit_rate  NUMERIC(10,2) NOT NULL CHECK (per_unit_rate >= 0),
  tenant_count   INTEGER       NOT NULL DEFAULT 0 CHECK (tenant_count >= 0),
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (room_id, for_month)
);

ALTER TABLE hms_room_ac_readings ENABLE ROW LEVEL SECURITY;

-- Owners can only see/manage readings for their own hostel
CREATE POLICY "owners_manage_ac_readings"
  ON hms_room_ac_readings
  FOR ALL
  USING  (hostel_id = (SELECT primary_hostel_id FROM hms_profiles WHERE id = auth.uid()))
  WITH CHECK (hostel_id = (SELECT primary_hostel_id FROM hms_profiles WHERE id = auth.uid()));

-- Index for fast month lookups per hostel
CREATE INDEX IF NOT EXISTS idx_ac_readings_hostel_month
  ON hms_room_ac_readings (hostel_id, for_month);
