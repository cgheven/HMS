-- Migration 060: Add AC meter reading table for mid-month checkout billing
-- Stores the meter reading when a tenant checks out mid-month.
-- Used to correctly split AC costs between the departed tenant and remaining tenants.

CREATE TABLE IF NOT EXISTS hms_room_ac_checkout_readings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  hostel_id UUID NOT NULL REFERENCES hms_hostels(id) ON DELETE CASCADE,
  room_id UUID NOT NULL REFERENCES hms_rooms(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES hms_tenants(id) ON DELETE CASCADE,
  for_month TEXT NOT NULL,
  meter_reading NUMERIC(10, 2) NOT NULL,
  units_consumed NUMERIC(10, 2) NOT NULL,
  tenant_count_at_checkout INTEGER NOT NULL,
  ac_charge NUMERIC(10, 2) NOT NULL DEFAULT 0,
  checkout_date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (room_id, tenant_id, for_month)
);

CREATE INDEX IF NOT EXISTS idx_ac_checkout_room_month ON hms_room_ac_checkout_readings(room_id, for_month);
CREATE INDEX IF NOT EXISTS idx_ac_checkout_hostel ON hms_room_ac_checkout_readings(hostel_id);
