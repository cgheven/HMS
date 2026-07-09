-- Add cumulative meter reading column to hms_room_ac_readings.
-- Stores the actual meter value at month end; consumption = this month's reading minus
-- previous month's reading. NULL for historical rows (which used total_units directly).
ALTER TABLE hms_room_ac_readings
  ADD COLUMN IF NOT EXISTS meter_reading NUMERIC(10, 2);
