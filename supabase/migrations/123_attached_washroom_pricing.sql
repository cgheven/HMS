-- Attached washroom as a per-room amenity + a flat, owner-editable price
-- premium (same shape as ac_per_unit_rate). Purely additive: every existing
-- room defaults to no washroom and every existing hostel defaults to a Rs 0
-- premium, so nothing changes for any current client until an owner
-- explicitly ticks a room and sets a non-zero premium.

ALTER TABLE hms_rooms
  ADD COLUMN IF NOT EXISTS has_attached_washroom boolean NOT NULL DEFAULT false;

ALTER TABLE hms_package_configs
  ADD COLUMN IF NOT EXISTS washroom_premium numeric NOT NULL DEFAULT 0;
