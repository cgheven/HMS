-- Addition: Al Rasheed Girls Hostel — R-block (R-1 to R-10)
-- Adds to existing hostel (G.R-1..G.R-9 already live from migration 055)
-- 10 new rooms · 23 tenants
-- Notes:
--   No CNIC or father name in source data (girls hostel practice)
--   R-1  Nimra Zafar     : joining date 31-10-2014 — 10+ year long-term tenant, recorded as-is
--   R-4  Ayasha + Noor Q : same phone 03005595828 — likely sisters sharing a contact
--   R-3  "13rth"         : corrected to 13th of month

DO $$
DECLARE
  h    uuid;
  rr1  uuid; rr2  uuid; rr3  uuid; rr4  uuid; rr5  uuid;
  rr6  uuid; rr7  uuid; rr8  uuid; rr9  uuid; rr10 uuid;
BEGIN
  SELECT id INTO h FROM hms_hostels WHERE name ILIKE '%Al Rasheed Girls%' LIMIT 1;
  IF h IS NULL THEN
    RAISE EXCEPTION 'Hostel "Al Rasheed Girls Hostel" not found';
  END IF;

  -- ============================================================
  -- ROOMS  (10 new rooms, total new capacity 29)
  -- ============================================================

  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'R-1',  3, 2, 'general', false, false, 0, 'available') RETURNING id INTO rr1;

  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'R-2',  3, 3, 'general', false, false, 0, 'occupied')  RETURNING id INTO rr2;

  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'R-3',  3, 1, 'general', false, false, 0, 'available') RETURNING id INTO rr3;

  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'R-4',  3, 3, 'general', false, false, 0, 'occupied')  RETURNING id INTO rr4;

  -- R-5: Sr2 = space, Sr1 and Sr3 occupied
  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'R-5',  3, 2, 'general', false, false, 0, 'available') RETURNING id INTO rr5;

  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'R-6',  3, 2, 'general', false, false, 0, 'available') RETURNING id INTO rr6;

  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'R-7',  3, 3, 'general', false, false, 0, 'occupied')  RETURNING id INTO rr7;

  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'R-8',  2, 2, 'general', false, false, 0, 'occupied')  RETURNING id INTO rr8;

  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'R-9',  3, 3, 'general', false, false, 0, 'occupied')  RETURNING id INTO rr9;

  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'R-10', 3, 2, 'general', false, false, 0, 'available') RETURNING id INTO rr10;

  -- ============================================================
  -- TENANTS  (23 tenants)
  -- ============================================================

  INSERT INTO hms_tenants (
    hostel_id, room_id, full_name, phone, cnic, type,
    check_in, billing_type, package_tier, monthly_rent, daily_rate,
    security_deposit, is_active, is_waiting, documents, notes
  ) VALUES

  -- R-1 (Nimra Zafar: 10+ year long-term tenant)
  (h, rr1,  'Nimra Zafar',           '03476796338', NULL, 'general', '2014-10-31', 'monthly', 'space_only', 14500, 0,  5000, true, false, '[]', 'Due: 1st of month'),
  (h, rr1,  'Hareem Sajid',           '03494816266', NULL, 'general', '2024-10-04', 'monthly', 'space_only', 14500, 0,  5000, true, false, '[]', 'Due: 1st of month'),

  -- R-2
  (h, rr2,  'Sabahat Saleem',         '03222988040', NULL, 'general', '2024-10-01', 'monthly', 'space_only', 14500, 0, 10000, true, false, '[]', 'Due: 1st of month'),
  (h, rr2,  'Kashaf Liaqat',          '03082645978', NULL, 'general', '2025-08-05', 'monthly', 'space_only', 14500, 0, 10000, true, false, '[]', 'Due: 1st of month'),
  (h, rr2,  'Noor Fatima',            '03024448799', NULL, 'general', '2025-08-02', 'monthly', 'space_only', 14500, 0, 10000, true, false, '[]', 'Due: 1st of month'),

  -- R-3
  (h, rr3,  'Bashaair Khan',          '03196471161', NULL, 'general', '2025-10-14', 'monthly', 'space_only', 14500, 0,     0, true, false, '[]', 'Due: 13th of month'),

  -- R-4 (Ayasha Qamar and Noor Qamar share same phone — likely sisters)
  (h, rr4,  'Ayasha Qamar',           '03005595828', NULL, 'general', '2024-10-07', 'monthly', 'space_only', 14000, 0,  5000, true, false, '[]', 'Due: 7th of month | Same phone as Noor Qamar — likely sisters'),
  (h, rr4,  'Noor Qamar',             '03005595828', NULL, 'general', '2024-10-07', 'monthly', 'space_only', 14000, 0,  5000, true, false, '[]', 'Due: 7th of month | Same phone as Ayasha Qamar — likely sisters'),
  (h, rr4,  'Ayasha Asghar',          '03016642933', NULL, 'general', '2024-10-07', 'monthly', 'space_only', 14000, 0,  5000, true, false, '[]', 'Due: 7th of month'),

  -- R-5 (Sr1, Sr3 occupied; Sr2 = space)
  (h, rr5,  'Mirab Zulfiqar',         '03327629834', NULL, 'general', '2024-09-04', 'monthly', 'space_only', 14500, 0, 10000, true, false, '[]', 'Due: 1st of month'),
  (h, rr5,  'Manahil Kashif',         '03286028712', NULL, 'general', '2024-08-08', 'monthly', 'space_only', 13500, 0,     0, true, false, '[]', 'Due: 1st of month'),

  -- R-6
  (h, rr6,  'Maryam Waheed',          '03045678069', NULL, 'general', '2025-09-04', 'monthly', 'space_only', 16500, 0, 10000, true, false, '[]', 'Due: 1st of month'),
  (h, rr6,  'Arooj Abas',             '03207268717', NULL, 'general', '2025-10-27', 'monthly', 'space_only', 14000, 0,     0, true, false, '[]', 'Due: 1st of month'),

  -- R-7
  (h, rr7,  'Aeeman Fatima',          '03144421302', NULL, 'general', '2024-08-01', 'monthly', 'space_only', 13500, 0,  5000, true, false, '[]', 'Due: 1st of month'),
  (h, rr7,  'Hafsa',                  '03430318056', NULL, 'general', '2025-08-01', 'monthly', 'space_only', 15000, 0, 10000, true, false, '[]', 'Due: 1st of month'),
  (h, rr7,  'Maria Shahid',           '03260962005', NULL, 'general', '2024-11-02', 'monthly', 'space_only', 14500, 0,     0, true, false, '[]', 'Due: 1st of month'),

  -- R-8
  (h, rr8,  'Bisma Khan',             '03070174499', NULL, 'general', '2024-10-30', 'monthly', 'space_only', 16500, 0,  8000, true, false, '[]', 'Due: 1st of month'),
  (h, rr8,  'Zarmeen Ahsaan',         '03700401400', NULL, 'general', '2024-10-01', 'monthly', 'space_only', 16000, 0,  5000, true, false, '[]', 'Due: 1st of month'),

  -- R-9
  (h, rr9,  'Maalaika Naeem',         '03163076197', NULL, 'general', '2024-10-31', 'monthly', 'space_only', 14000, 0,     0, true, false, '[]', 'Due: 1st of month'),
  (h, rr9,  'Suman Murtaza',          '03183513720', NULL, 'general', '2024-10-31', 'monthly', 'space_only', 14000, 0,     0, true, false, '[]', 'Due: 1st of month'),
  (h, rr9,  'Noro Zoha',              '03418362343', NULL, 'general', '2024-10-31', 'monthly', 'space_only', 12000, 0,     0, true, false, '[]', 'Due: 1st of month'),

  -- R-10
  (h, rr10, 'Anum',                   '03481744193', NULL, 'general', '2024-07-01', 'monthly', 'space_only', 13500, 0,  5000, true, false, '[]', 'Due: 1st of month'),
  (h, rr10, 'Fatima Hussain',         '03260871559', NULL, 'general', '2025-08-06', 'monthly', 'space_only', 16000, 0, 10000, true, false, '[]', 'Due: 1st of month');

  -- ============================================================
  -- RESYNC HOSTEL TOTAL CAPACITY (G.R + R blocks combined)
  -- ============================================================
  UPDATE hms_hostels
  SET total_capacity = (SELECT COALESCE(SUM(capacity), 0) FROM hms_rooms WHERE hostel_id = h)
  WHERE id = h;

END $$;
