-- Onboarding: Al Rasheed Girls Hostel
-- 9 rooms (G.R-1 to G.R-9) · 5 tenants
-- Notes:
--   No CNIC or father name columns in source data (girls hostel privacy practice)
--   G.R-4 Sr3 Samiya Batool : due date column reads "warden" — resident warden, rent 0
--   G.R-4 Sr4 Zunaira Arshad: phone "0346894703" is 10 digits (should be 11) — stored as-is, verify with owner

DO $$
DECLARE
  h    uuid;
  rgr1 uuid; rgr2 uuid; rgr3 uuid; rgr4 uuid; rgr5 uuid;
  rgr6 uuid; rgr7 uuid; rgr8 uuid; rgr9 uuid;
BEGIN
  SELECT id INTO h FROM hms_hostels WHERE name ILIKE '%Al Rasheed Girls%' LIMIT 1;
  IF h IS NULL THEN
    RAISE EXCEPTION 'Hostel "Al Rasheed Girls Hostel" not found — verify exact name in hms_hostels';
  END IF;

  IF EXISTS (SELECT 1 FROM hms_rooms WHERE hostel_id = h LIMIT 1) THEN
    RAISE EXCEPTION 'Rooms already exist for this hostel — migration likely already applied';
  END IF;

  -- ============================================================
  -- ROOMS  (9 rooms, total capacity 31)
  -- ============================================================

  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'G.R-1', 2, 1, 'general', false, false, 0, 'available') RETURNING id INTO rgr1;

  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'G.R-2', 4, 0, 'general', false, false, 0, 'available') RETURNING id INTO rgr2;

  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'G.R-3', 3, 1, 'general', false, false, 0, 'available') RETURNING id INTO rgr3;

  -- G.R-4: Sr1 & 2 = space, Sr3 = warden (Samiya Batool), Sr4 = Zunaira Arshad
  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'G.R-4', 4, 2, 'general', false, false, 0, 'available') RETURNING id INTO rgr4;

  -- G.R-5: Sr1 = space, Sr2 = Huma Fatima, Sr3 = space
  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'G.R-5', 3, 1, 'general', false, false, 0, 'available') RETURNING id INTO rgr5;

  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'G.R-6', 4, 0, 'general', false, false, 0, 'available') RETURNING id INTO rgr6;

  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'G.R-7', 3, 0, 'general', false, false, 0, 'available') RETURNING id INTO rgr7;

  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'G.R-8', 4, 0, 'general', false, false, 0, 'available') RETURNING id INTO rgr8;

  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'G.R-9', 4, 0, 'general', false, false, 0, 'available') RETURNING id INTO rgr9;

  -- ============================================================
  -- TENANTS  (5 tenants; no CNIC or father name in source data)
  -- ============================================================

  INSERT INTO hms_tenants (
    hostel_id, room_id, full_name, phone, cnic, type,
    check_in, billing_type, package_tier, monthly_rent, daily_rate,
    security_deposit, is_active, is_waiting, documents, notes
  ) VALUES

  -- G.R-1
  (h, rgr1, 'Navera Irshad',   '03314581536', NULL, 'general', '2024-01-28', 'monthly', 'space_only', 12000, 0, 5000, true, false, '[]', 'Due: 1st of month'),

  -- G.R-3
  (h, rgr3, 'Nida Zafar',      '03281837600', NULL, 'general', '2024-06-01', 'monthly', 'space_only', 13500, 0,    0, true, false, '[]', 'Due: 1st of month'),

  -- G.R-4 (Sr3 = warden; Sr4 = paying tenant with 10-digit phone)
  (h, rgr4, 'Samiya Batool',   '03475823063', NULL, 'general', '2024-10-01', 'monthly', 'space_only',     0, 0,    0, true, false, '[]', 'Resident warden — due date field reads "warden", rent 0'),
  (h, rgr4, 'Zunaira Arshad',  '0346894703',  NULL, 'general', '2024-03-05', 'monthly', 'space_only', 14000, 0,    0, true, false, '[]', 'Due: 1st of month | Phone "0346894703" is 10 digits — likely missing 1 digit, verify with owner'),

  -- G.R-5 (Sr2 occupied; Sr1 & Sr3 space)
  (h, rgr5, 'Huma Fatima',     '03364968578', NULL, 'general', '2024-10-15', 'monthly', 'space_only', 14000, 0, 6000, true, false, '[]', 'Due: 15th of month');

  -- ============================================================
  -- SYNC HOSTEL TOTAL CAPACITY
  -- ============================================================
  UPDATE hms_hostels
  SET total_capacity = (SELECT COALESCE(SUM(capacity), 0) FROM hms_rooms WHERE hostel_id = h)
  WHERE id = h;

END $$;
