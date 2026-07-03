-- Per-tenant meter reading captured at the moment a mid-month joiner is assigned.
-- Enables segment-based AC billing: units are split proportionally to each
-- tenant's time-in-room rather than by a flat equal share.

CREATE TABLE IF NOT EXISTS hms_room_ac_join_readings (
  id             UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  hostel_id      UUID          NOT NULL REFERENCES hms_hostels(id)  ON DELETE CASCADE,
  room_id        UUID          NOT NULL REFERENCES hms_rooms(id)    ON DELETE CASCADE,
  for_month      TEXT          NOT NULL CHECK (for_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  tenant_id      UUID          NOT NULL REFERENCES hms_tenants(id)  ON DELETE CASCADE,
  units_at_join  NUMERIC(10,2) NOT NULL CHECK (units_at_join >= 0),
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (room_id, for_month, tenant_id)
);

ALTER TABLE hms_room_ac_join_readings ENABLE ROW LEVEL SECURITY;

-- Mirror the same RLS pattern from 045_ac_billing_fixes.sql:
-- owners + active partners can read; only owners can write.
CREATE POLICY "members_read_ac_join_readings"
  ON hms_room_ac_join_readings
  FOR SELECT
  USING (
    hostel_id IN (
      SELECT id        FROM hms_hostels     WHERE owner_id    = auth.uid()
      UNION ALL
      SELECT hostel_id FROM hms_partnerships WHERE partner_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "owners_write_ac_join_readings"
  ON hms_room_ac_join_readings
  FOR ALL
  USING    (hostel_id IN (SELECT id FROM hms_hostels WHERE owner_id = auth.uid()))
  WITH CHECK (hostel_id IN (SELECT id FROM hms_hostels WHERE owner_id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_ac_join_readings_room_month
  ON hms_room_ac_join_readings (room_id, for_month);

CREATE INDEX IF NOT EXISTS idx_ac_join_readings_hostel_month
  ON hms_room_ac_join_readings (hostel_id, for_month);
