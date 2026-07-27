-- Onboarding: Ms National Boys hostel
-- 51 rooms (G-1 to G-23 ground floor, F-1 to F-28 first floor) · no tenants yet
-- monthly_rent left at 0 — pricing not yet configured, rooms only.

DO $$
DECLARE
  h uuid;
BEGIN
  SELECT id INTO h FROM hms_hostels WHERE name ILIKE '%Ms National Boys hostel%' LIMIT 1;
  IF h IS NULL THEN
    RAISE EXCEPTION 'Hostel "Ms National Boys hostel" not found — verify the exact name in hms_hostels';
  END IF;

  IF EXISTS (SELECT 1 FROM hms_rooms WHERE hostel_id = h LIMIT 1) THEN
    RAISE EXCEPTION 'Rooms already exist for this hostel — migration likely already applied';
  END IF;

  INSERT INTO hms_rooms (hostel_id, room_number, floor, capacity, type, has_ac, has_cooler)
  VALUES
  (h, 'G-1', 0, 2, 'student', false, false),
  (h, 'F-1', 1, 3, 'student', false, false),
  (h, 'G-2', 0, 2, 'student', false, false),
  (h, 'F-2', 1, 3, 'student', false, true),
  (h, 'G-3', 0, 2, 'student', false, false),
  (h, 'F-3', 1, 1, 'student', false, false),
  (h, 'G-4', 0, 2, 'student', false, false),
  (h, 'F-4', 1, 1, 'student', false, false),
  (h, 'G-5', 0, 2, 'student', false, false),
  (h, 'F-5', 1, 3, 'student', false, true),
  (h, 'G-6', 0, 2, 'student', false, false),
  (h, 'F-6', 1, 3, 'student', false, true),
  (h, 'G-7', 0, 2, 'student', false, false),
  (h, 'F-7', 1, 2, 'student', false, true),
  (h, 'G-8', 0, 2, 'student', false, false),
  (h, 'F-8', 1, 1, 'professional', false, false),
  (h, 'G-9', 0, 2, 'student', false, false),
  (h, 'F-9', 1, 1, 'student', false, false),
  (h, 'G-10', 0, 2, 'student', false, false),
  (h, 'F-10', 1, 1, 'student', false, false),
  (h, 'G-11', 0, 2, 'student', false, false),
  (h, 'F-11', 1, 1, 'student', false, false),
  (h, 'G-12', 0, 2, 'student', false, false),
  (h, 'F-12', 1, 1, 'student', false, false),
  (h, 'G-13', 0, 2, 'student', false, false),
  (h, 'F-13', 1, 1, 'student', false, false),
  (h, 'G-14', 0, 2, 'student', false, false),
  (h, 'F-14', 1, 1, 'professional', false, false),
  (h, 'G-15', 0, 2, 'student', false, false),
  (h, 'F-15', 1, 2, 'student', false, false),
  (h, 'G-16', 0, 3, 'student', false, false),
  (h, 'F-16', 1, 5, 'student', false, false),
  (h, 'G-17', 0, 2, 'student', false, false),
  (h, 'F-17', 1, 3, 'student', false, false),
  (h, 'G-18', 0, 2, 'professional', false, false),
  (h, 'F-18', 1, 1, 'student', false, false),
  (h, 'G-19', 0, 1, 'student', false, false),
  (h, 'F-19', 1, 1, 'student', false, false),
  (h, 'G-20', 0, 1, 'student', false, false),
  (h, 'F-20', 1, 3, 'student', false, false),
  (h, 'G-21', 0, 1, 'student', false, false),
  (h, 'F-21', 1, 3, 'student', false, true),
  (h, 'G-22', 0, 1, 'student', false, false),
  (h, 'F-22', 1, 1, 'student', false, false),
  (h, 'G-23', 0, 1, 'student', false, false),
  (h, 'F-23', 1, 1, 'student', false, true),
  (h, 'F-24', 1, 2, 'student', false, false),
  (h, 'F-25', 1, 2, 'student', false, true),
  (h, 'F-26', 1, 2, 'student', false, true),
  (h, 'F-27', 1, 2, 'student', false, true),
  (h, 'F-28', 1, 1, 'student', false, true);

  UPDATE hms_hostels
  SET total_capacity = (SELECT COALESCE(SUM(capacity), 0) FROM hms_rooms WHERE hostel_id = h)
  WHERE id = h;

END $$;
