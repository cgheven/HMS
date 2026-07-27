-- Onboarding: Makkah Boys Hostel Branch # 2
-- 65 rentable rooms (room register groups G.1-G.8, all Floor 1), 123 total seats.
-- Extracted from photographed room register pages; capacities cross-checked
-- against the "Total Seats" figure handwritten on every register page (all match).
--
-- Excluded on purpose: register serial "147-148-149 Store" (capacity 0, no
-- SpaceType fits a non-rentable store room) — pending client confirmation on
-- whether to keep it on record at all (see onboarding query F2).
--
-- Room Type set to 'student' for all rooms (no room-level type was recorded
-- in the register; this matches the default used for the last hostel onboarded
-- this way). Tenants are NOT part of this migration — rent/deposit figures are
-- blank on every admission form and several room/identity conflicts are still
-- pending the client's confirmation (see the two onboarding prep documents).

DO $$
DECLARE
  h uuid := 'd07c9237-a8cb-4292-9e6e-b86a4cee7447'; -- Makkah Boys Hostel Branch # 2
BEGIN
  IF NOT EXISTS (SELECT 1 FROM hms_hostels WHERE id = h) THEN
    RAISE EXCEPTION 'Hostel id % not found — verify Makkah Boys Hostel Branch # 2 still has this id', h;
  END IF;

  IF EXISTS (SELECT 1 FROM hms_rooms WHERE hostel_id = h LIMIT 1) THEN
    RAISE EXCEPTION 'Rooms already exist for this hostel — migration likely already applied';
  END IF;

  INSERT INTO hms_rooms (hostel_id, room_number, floor, capacity, type, has_ac, has_cooler, has_attached_washroom)
  VALUES
  (h, '101', 1, 2, 'student', false, false, false),
  (h, '102', 1, 2, 'student', false, false, false),
  (h, '103', 1, 2, 'student', false, false, false),
  (h, '104', 1, 2, 'student', false, false, false),
  (h, '105', 1, 2, 'student', false, false, true),
  (h, '106', 1, 1, 'student', false, false, true),
  (h, '107', 1, 1, 'student', false, false, false),
  (h, '108', 1, 1, 'student', false, false, false),
  (h, '109', 1, 1, 'student', false, false, false),
  (h, '110', 1, 2, 'student', false, false, false),
  (h, '111', 1, 1, 'student', false, false, false),
  (h, '112', 1, 1, 'student', false, false, false),
  (h, '113', 1, 1, 'student', false, false, true),
  (h, '114', 1, 1, 'student', false, false, true),
  (h, '115', 1, 2, 'student', false, false, false),
  (h, '116', 1, 2, 'student', false, false, false),
  (h, '117', 1, 2, 'student', false, false, false),
  (h, '118', 1, 2, 'student', false, false, false),
  (h, '119', 1, 2, 'student', false, false, false),
  (h, '120', 1, 2, 'student', false, false, false),
  (h, '121', 1, 1, 'student', false, false, true),
  (h, '122', 1, 2, 'student', true, false, true),
  (h, '123', 1, 1, 'student', false, false, false),
  (h, '124', 1, 2, 'student', false, false, false),
  (h, '125', 1, 1, 'student', false, false, false),
  (h, '126', 1, 2, 'student', false, false, false),
  (h, '127', 1, 1, 'student', false, false, false),
  (h, '128', 1, 1, 'student', false, false, false),
  (h, '129', 1, 3, 'student', true, false, false),
  (h, '130', 1, 3, 'student', false, false, false),
  (h, '131', 1, 3, 'student', true, false, false),
  (h, '132', 1, 3, 'student', true, false, true),
  (h, '133', 1, 3, 'student', true, false, true),
  (h, '134', 1, 2, 'student', false, false, false),
  (h, '135', 1, 2, 'student', false, false, false),
  (h, '136', 1, 2, 'student', false, false, true),
  (h, '137', 1, 2, 'student', false, false, true),
  (h, '138', 1, 2, 'student', false, false, true),
  (h, '139', 1, 2, 'student', false, false, true),
  (h, '140', 1, 2, 'student', false, false, true),
  (h, '141', 1, 2, 'student', false, false, true),
  (h, '142', 1, 2, 'student', true, false, false),
  (h, '143', 1, 3, 'student', true, false, false),
  (h, '144', 1, 2, 'student', false, false, true),
  (h, '145', 1, 2, 'student', false, false, true),
  (h, '146', 1, 4, 'student', false, false, true),
  (h, '150', 1, 2, 'student', false, false, false),
  (h, '151', 1, 2, 'student', false, false, false),
  (h, '152', 1, 2, 'student', false, false, false),
  (h, '153', 1, 1, 'student', false, false, true),
  (h, '154', 1, 2, 'student', false, false, false),
  (h, '155', 1, 2, 'student', false, false, false),
  (h, '156', 1, 2, 'student', false, false, false),
  (h, '157', 1, 2, 'student', false, false, false),
  (h, '158', 1, 2, 'student', false, false, false),
  (h, '159', 1, 2, 'student', false, false, false),
  (h, '160', 1, 1, 'student', false, false, false),
  (h, '161', 1, 1, 'student', false, false, false),
  (h, '162', 1, 1, 'student', false, false, false),
  (h, '163', 1, 2, 'student', false, false, false),
  (h, '164', 1, 2, 'student', false, false, false),
  (h, '165', 1, 2, 'student', false, false, false),
  (h, '166', 1, 4, 'student', false, false, false),
  (h, '167', 1, 2, 'student', false, false, false),
  (h, '168', 1, 2, 'student', false, false, false);

  UPDATE hms_hostels
  SET total_capacity = (SELECT COALESCE(SUM(capacity), 0) FROM hms_rooms WHERE hostel_id = h)
  WHERE id = h;

END $$;
