-- Fix 1: Strengthen the for_month CHECK to reject invalid months like 2024-00 / 2024-13
ALTER TABLE hms_room_ac_readings
  DROP CONSTRAINT IF EXISTS hms_room_ac_readings_for_month_check;
ALTER TABLE hms_room_ac_readings
  ADD CONSTRAINT hms_room_ac_readings_for_month_check
  CHECK (for_month ~ '^\d{4}-(0[1-9]|1[0-2])$');

-- Fix 2: Replace the primary_hostel_id-based RLS with a hostel-membership check
-- so multi-hostel owners and partners can read readings for their active hostel.
-- Writes still go through createAdminClient() in server actions (bypasses RLS),
-- so write-side policy is a safety net only.
DROP POLICY IF EXISTS "owners_manage_ac_readings" ON hms_room_ac_readings;

CREATE POLICY "members_read_ac_readings"
  ON hms_room_ac_readings
  FOR SELECT
  USING (
    hostel_id IN (
      SELECT id        FROM hms_hostels     WHERE owner_id    = auth.uid()
      UNION ALL
      SELECT hostel_id FROM hms_partnerships WHERE partner_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "owners_write_ac_readings"
  ON hms_room_ac_readings
  FOR ALL
  USING    (hostel_id IN (SELECT id FROM hms_hostels WHERE owner_id = auth.uid()))
  WITH CHECK (hostel_id IN (SELECT id FROM hms_hostels WHERE owner_id = auth.uid()));
