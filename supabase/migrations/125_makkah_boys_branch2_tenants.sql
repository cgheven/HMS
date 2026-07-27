-- Onboarding: Makkah Boys Hostel Branch # 2 — tenants (phase 1 of 2)
--
-- 39 of the 64 register-derived tenant rows, imported now because their room
-- assignment is unambiguous. The remaining 25 are deliberately NOT included
-- here, pending the client's answers to the two onboarding prep documents:
--   - 6  : two rooms have more names than capacity allows (G5-142, G6-150)
--          — unclear which occupant doesn't actually belong there
--   - 1  : "Shahi Rom" (G7-160) — likely a room label, not a tenant name
--   - 14 : same first name recorded in two different rooms, with no
--          independent confirmation of which occurrence is which person
--   - 4  : admission forms with no room/bed at all — presence at this
--          branch itself is unconfirmed
--
-- monthly_rent is 0 and type is 'general' for all 39 — neither is known yet
-- (every admission-form receipt section was blank; the register never
-- recorded a per-tenant type). check_in defaults to CURRENT_DATE (today) for
-- the ~20 rows with no confirmed date — this is a placeholder, not a real
-- admission date, and must be corrected once real records are available.
-- The ~19 rows independently confirmed via a matched admission form carry
-- their real check-in date and contact details (phone/CNIC).

DO $$
DECLARE
  h uuid := 'd07c9237-a8cb-4292-9e6e-b86a4cee7447'; -- Makkah Boys Hostel Branch # 2
BEGIN
  IF NOT EXISTS (SELECT 1 FROM hms_hostels WHERE id = h) THEN
    RAISE EXCEPTION 'Hostel id % not found', h;
  END IF;

  IF EXISTS (SELECT 1 FROM hms_tenants WHERE hostel_id = h LIMIT 1) THEN
    RAISE EXCEPTION 'Tenants already exist for this hostel — migration likely already applied';
  END IF;

  INSERT INTO hms_tenants (hostel_id, room_id, full_name, phone, cnic, check_in, monthly_rent, type)
  SELECT h, r.id, v.full_name, v.phone, v.cnic, COALESCE(v.check_in, CURRENT_DATE), 0, 'general'
  FROM (VALUES
  ('103', 'Farukh', NULL, NULL, NULL),
  ('103', 'M. Adeen', '0334-5456417', '33301-5567061-1', '2026-07-09'::date),
  ('107', 'Shoaib Malik', NULL, NULL, NULL),
  ('110', 'Shabbir Z.', NULL, NULL, NULL),
  ('110', 'Aamir Z.', NULL, NULL, NULL),
  ('112', 'Sultan Mahmood', '0343-9356306', '21704-5526877-7', '2026-06-30'::date),
  ('113', 'M. Arham', NULL, NULL, NULL),
  ('114', 'Adil Shah', NULL, NULL, NULL),
  ('122', 'M. Ahmad', NULL, NULL, NULL),
  ('125', 'Bismillah Malik', NULL, NULL, NULL),
  ('126', 'Saad Abdullah', NULL, NULL, NULL),
  ('128', 'Salman', NULL, NULL, NULL),
  ('129', 'Muhammad Aqib Siddique', '0311-0277291', '39202-6118061-5', '2026-07-10'::date),
  ('129', 'Zeeshan', NULL, NULL, NULL),
  ('129', 'Muhammad Usman', '0306-9881366', '36603-4941930-9', '2026-07-10'::date),
  ('130', 'Aqeel Ahmad', '0343-6659342', '38303-3548314-3', '2026-06-07'::date),
  ('130', 'Mateen Iqbal', '0342-8564467', '32103-1335578-1', '2026-06-16'::date),
  ('130', 'Saqib', NULL, NULL, NULL),
  ('131', 'Zaman', NULL, NULL, NULL),
  ('132', 'Muhammad Umar', '0333-8883388', '31203-7999112-5', '2026-06-28'::date),
  ('132', 'M. Reyan Zahid', '0304-1377329', '31203-3851225-1', '2026-06-28'::date),
  ('132', 'Rehan Anwaar', '0324-9185129', '31203-6306932-1', '2026-07-07'::date),
  ('133', 'Abbas Khan', NULL, NULL, NULL),
  ('133', 'Ahmad Raza', NULL, NULL, NULL),
  ('133', 'Hafiz Abu Bakar', NULL, NULL, NULL),
  ('134', 'Waheed', NULL, NULL, NULL),
  ('136', 'Zubair', NULL, NULL, NULL),
  ('136', 'Shakeel', NULL, NULL, NULL),
  ('141', 'Hateem', NULL, NULL, NULL),
  ('146', 'Abdul Rauf', '0340-8960080', '32102-7718008-3', '2026-06-05'::date),
  ('146', 'Muhammad Azan Danish Qureshi', '0371-0676467', NULL, '2026-06-06'::date),
  ('146', 'Muneeb', NULL, NULL, NULL),
  ('153', 'Haider Ali', NULL, NULL, NULL),
  ('161', 'Sarfaraz', NULL, NULL, NULL),
  ('162', 'Roman', NULL, NULL, NULL),
  ('166', 'Muhammad Huzaifa Mughal', '0335-1637444', '34801-7545410-6', '2026-07-12'::date),
  ('166', 'Muhammad Sufyan Siddiqui', '0322-1004329', '34502-6418065-5', '2026-07-12'::date),
  ('166', 'Muhammad Umar', '0332-4714265', '42401-3318191-1', '2026-07-12'::date),
  ('166', 'Aneeb ur Rehman', '0341-8465754', '34501-4688767-5', '2026-07-12'::date)
  ) AS v(room_number, full_name, phone, cnic, check_in)
  JOIN hms_rooms r ON r.hostel_id = h AND r.room_number = v.room_number;

  -- Sync each room's occupied count from the tenants just inserted.
  UPDATE hms_rooms r
  SET occupied = (SELECT count(*) FROM hms_tenants t WHERE t.room_id = r.id AND t.is_active)
  WHERE r.hostel_id = h;

  UPDATE hms_rooms r
  SET status = CASE WHEN r.occupied >= r.capacity THEN 'occupied' ELSE 'available' END
  WHERE r.hostel_id = h;

END $$;
