-- Applications now capture the ACTUAL room a prospective tenant selected
-- (not just a vague category string via room_preference), so approving an
-- application can auto-fill the real room instead of staff re-selecting it.
-- Nullable — a hostel can disable room selection on the form, or the room
-- could later be deleted, in which case the application just falls back to
-- manual selection during approval exactly as it does today.

ALTER TABLE hms_tenant_applications
  ADD COLUMN IF NOT EXISTS room_id UUID REFERENCES hms_rooms(id) ON DELETE SET NULL;
