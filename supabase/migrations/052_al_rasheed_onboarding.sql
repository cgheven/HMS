-- Onboarding: Al Rasheed Boys Hostel
-- 25 rooms (G-1 to G-6, A-1 to A-8, B-1 to B-8, C-1 to C-3) · 51 tenants
-- Data corrections applied:
--   G-6  Javid Ahmad      : "39/03/2026" → 2026-03-29 (day 39 doesn't exist)
--   A-3  Muhammad Nasir   : CNIC "313013835328-9" reformatted → "31301-3835328-9"
--   B-5  Muhammad Homam   : CNIC dots replaced with dashes → "35103-0166560-7"
--   B-5  Muhammad Homam   : Phone "030185422628" stored as-is (12 digits, likely typo)
--   A-2  Nabeel Ahmed     : Rent "18,500" → 18500
--   G-2  M Talah          : Security split 5000 room + 30000 AC = 35000 total
--   B-8  Farhan Chauhdary : Security split 10000 room + 24000 AC = 34000 total; B-8 flagged has_ac
--   A-8                   : Sr 1 and 3 present, Sr 2 absent → capacity 3, occupied 2

DO $$
DECLARE
  h    uuid;
  r_g1 uuid; r_g2 uuid; r_g3 uuid; r_g4 uuid; r_g5 uuid; r_g6 uuid;
  r_a1 uuid; r_a2 uuid; r_a3 uuid; r_a4 uuid; r_a5 uuid; r_a6 uuid; r_a7 uuid; r_a8 uuid;
  r_b1 uuid; r_b2 uuid; r_b3 uuid; r_b4 uuid; r_b5 uuid; r_b6 uuid; r_b7 uuid; r_b8 uuid;
  r_c1 uuid; r_c2 uuid; r_c3 uuid;
BEGIN
  SELECT id INTO h FROM hms_hostels WHERE name ILIKE '%Al Rasheed Boys Hostel%' LIMIT 1;
  IF h IS NULL THEN
    RAISE EXCEPTION 'Hostel "Al Rasheed Boys Hostel" not found — verify the exact name in hms_hostels';
  END IF;

  IF EXISTS (SELECT 1 FROM hms_rooms WHERE hostel_id = h LIMIT 1) THEN
    RAISE EXCEPTION 'Rooms already exist for this hostel — migration likely already applied';
  END IF;

  -- ============================================================
  -- ROOMS
  -- ============================================================

  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'G-1', 3, 2, 'general', false, false, 0, 'available') RETURNING id INTO r_g1;

  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'G-2', 2, 2, 'general', true,  false, 0, 'occupied')  RETURNING id INTO r_g2;

  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'G-3', 2, 2, 'general', false, false, 0, 'occupied')  RETURNING id INTO r_g3;

  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'G-4', 2, 2, 'general', false, false, 0, 'occupied')  RETURNING id INTO r_g4;

  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'G-5', 3, 0, 'general', true,  false, 0, 'available') RETURNING id INTO r_g5;

  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'G-6', 3, 2, 'general', false, false, 0, 'available') RETURNING id INTO r_g6;

  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'A-1', 3, 3, 'general', false, false, 0, 'occupied')  RETURNING id INTO r_a1;

  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'A-2', 3, 3, 'general', false, false, 0, 'occupied')  RETURNING id INTO r_a2;

  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'A-3', 2, 1, 'general', false, false, 0, 'available') RETURNING id INTO r_a3;

  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'A-4', 3, 2, 'general', false, false, 0, 'available') RETURNING id INTO r_a4;

  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'A-5', 2, 2, 'general', false, false, 0, 'occupied')  RETURNING id INTO r_a5;

  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'A-6', 3, 3, 'general', false, false, 0, 'occupied')  RETURNING id INTO r_a6;

  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'A-7', 3, 2, 'general', false, false, 0, 'available') RETURNING id INTO r_a7;

  -- A-8: Sr 1 and 3 occupied, Sr 2 absent → capacity 3, occupied 2
  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'A-8', 3, 2, 'general', true,  false, 0, 'available') RETURNING id INTO r_a8;

  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'B-1', 3, 3, 'general', false, false, 0, 'occupied')  RETURNING id INTO r_b1;

  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'B-2', 3, 3, 'general', true,  false, 0, 'occupied')  RETURNING id INTO r_b2;

  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'B-3', 2, 2, 'general', false, false, 0, 'occupied')  RETURNING id INTO r_b3;

  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'B-4', 3, 3, 'general', true,  false, 0, 'occupied')  RETURNING id INTO r_b4;

  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'B-5', 3, 3, 'general', true,  false, 0, 'occupied')  RETURNING id INTO r_b5;

  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'B-6', 2, 2, 'general', false, false, 0, 'occupied')  RETURNING id INTO r_b6;

  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'B-7', 3, 2, 'general', false, false, 0, 'available') RETURNING id INTO r_b7;

  -- B-8: has AC security charge listed → has_ac = true
  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'B-8', 2, 1, 'general', true,  false, 0, 'available') RETURNING id INTO r_b8;

  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'C-1', 2, 2, 'general', false, false, 0, 'occupied')  RETURNING id INTO r_c1;

  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'C-2', 3, 2, 'general', false, false, 0, 'available') RETURNING id INTO r_c2;

  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'C-3', 2, 0, 'general', false, false, 0, 'available') RETURNING id INTO r_c3;

  -- ============================================================
  -- TENANTS  (father name + due day stored in notes)
  -- ============================================================

  INSERT INTO hms_tenants (
    hostel_id, room_id, full_name, phone, cnic, type,
    check_in, billing_type, package_tier, monthly_rent, daily_rate,
    security_deposit, is_active, is_waiting, documents, notes
  ) VALUES

  -- G-1
  (h, r_g1, 'Mohammad Arsalan',          '03006976859', '35301-6881036-7', 'general', '2026-06-30', 'monthly', 'space_only', 18500, 0,     0, true, false, '[]', 'Father: Mohammad Nadeem | Due: 1st of month'),
  (h, r_g1, 'Shaheer Khan',              '03701962781', '13302-2622876-1', 'general', '2026-06-08', 'monthly', 'space_only', 18500, 0, 10000, true, false, '[]', 'Father: Sajid | Due: 1st of month'),

  -- G-2
  (h, r_g2, 'M Talah',                   '03100405971', '35401-5584410-3', 'general', '2026-06-06', 'monthly', 'space_only', 20000, 0, 35000, true, false, '[]', 'Father: Sadaqat Naseem | Due: 1st of month | Security: 5000 room + 30000 AC'),
  (h, r_g2, 'M Kabeer',                  '03058998878', '35401-8510987-5', 'general', '2026-06-06', 'monthly', 'space_only', 20000, 0,  5000, true, false, '[]', 'Father: Shbaz Ali | Due: 1st of month'),

  -- G-3
  (h, r_g3, 'Uzair Akram',               '03201529345', '34103-4325685-3', 'general', '2023-04-28', 'monthly', 'space_only', 16500, 0,  6500, true, false, '[]', 'Father: Muhammad Akram | Due: 1st of month'),
  (h, r_g3, 'Muhammad Faisal',           '03414477437', '32303-3326957-1', 'general', '2023-06-03', 'monthly', 'space_only', 16500, 0,     0, true, false, '[]', 'Father: Ghulam Fareed | Due: 1st of month'),

  -- G-4
  (h, r_g4, 'Awais Afzal',               '03118137447', '35302-9647825-9', 'general', '2026-05-01', 'monthly', 'space_only', 20000, 0, 10000, true, false, '[]', 'Father: Muhammad Afzal Sabri | Due: 1st of month'),
  (h, r_g4, 'Abu Huraira',               '03006894621', '36302-5496106-3', 'general', '2026-05-01', 'monthly', 'space_only', 14500, 0,  5500, true, false, '[]', 'Father: Liaqat Ali | Due: 1st of month'),

  -- G-6 (joining date "39/03/2026" corrected to 2026-03-29)
  (h, r_g6, 'Javid Ahmad',               '03054399900', '38302-3239310-1', 'general', '2026-03-29', 'monthly', 'space_only', 12500, 0,     0, true, false, '[]', 'Father: Amir Muhammad | Due: 1st of month | Joining date in source was "39/03/2026" — corrected to 29/03/2026'),
  (h, r_g6, 'Abdul Mannan',              '03018753903', '37302-5719636-5', 'general', '2025-05-01', 'monthly', 'space_only', 12500, 0, 10000, true, false, '[]', 'Father: Mushtaq Ahmad Shaheen | Due: 1st of month'),

  -- A-1
  (h, r_a1, 'Husnain Abbas',             '03458385325', '34301-6059302-9', 'general', '2025-04-26', 'monthly', 'space_only', 12500, 0,     0, true, false, '[]', 'Father: Sattar Hussain | Due: 1st of month'),
  (h, r_a1, 'Mohsin Ali',                '03045436383', '31101-2294465-5', 'general', '2026-03-13', 'monthly', 'space_only', 12000, 0,     0, true, false, '[]', 'Father: Liaqat Ali | Due: 1st of month'),
  (h, r_a1, 'Muhammad Ahmad',            '03032544541', '36603-4353770-5', 'general', '2025-12-09', 'monthly', 'space_only', 19000, 0,  5000, true, false, '[]', 'Father: Shahid Iqbal | Due: 8th of month'),

  -- A-2
  (h, r_a2, 'Sayed Moeed',               '03312152615', '42301-3923963-9', 'general', '2024-07-31', 'monthly', 'space_only', 12000, 0, 10000, true, false, '[]', 'Father: Sayed Irfan Ahmad | Due: 1st of month'),
  (h, r_a2, 'Muhammad Haseeb',           '03286605892', '32302-3308584-5', 'general', '2025-09-13', 'monthly', 'space_only', 18000, 0,     0, true, false, '[]', 'Father: Attaullah Khan | Due: 1st of month'),
  (h, r_a2, 'Nabeel Ahmed',              '03095449044', '45502-7182612-1', 'general', '2026-07-01', 'monthly', 'space_only', 18500, 0,  5000, true, false, '[]', 'Father: Allah Rakha | Due: 1st of month'),

  -- A-3 (CNIC "313013835328-9" reformatted to standard 5-7-1 pattern)
  (h, r_a3, 'Muhammad Nasir',            '03009347002', '31301-3835328-9', 'general', '2026-02-11', 'monthly', 'space_only', 20500, 0,  5000, true, false, '[]', 'Father: Abdul Waheed | Due: 1st of month'),

  -- A-4
  (h, r_a4, 'Ejaz Hussain',              '03062888994', '36104-4300628-3', 'general', '2022-06-01', 'monthly', 'space_only', 19000, 0,     0, true, false, '[]', 'Father: Riaz Hussain | Due: 1st of month'),
  (h, r_a4, 'Kashif Naeem',              '03037170664', '36401-6653404-7', 'general', '2023-05-15', 'monthly', 'space_only', 11500, 0,  6500, true, false, '[]', 'Father: Zulfiqar Ali | Due: 1st of month'),

  -- A-5
  (h, r_a5, 'Muhammad Tauqeer',          '03218632144', '54400-4267071-7', 'general', '2024-12-03', 'monthly', 'space_only', 18000, 0,     0, true, false, '[]', 'Father: Muhammad Tanveer | Due: 1st of month'),
  (h, r_a5, 'Shayan Ahmad',              '03057057179', '38403-1089882-7', 'general', '2025-10-03', 'monthly', 'space_only', 20000, 0,     0, true, false, '[]', 'Father: Muhammad Saeed | Due: 2nd of month'),

  -- A-6
  (h, r_a6, 'Muhammad Sharjeel',         '03202274316', '33303-0542214-9', 'general', '2026-01-05', 'monthly', 'space_only', 12500, 0,  5000, true, false, '[]', 'Father: Farooq Ahsan | Due: 5th of month'),
  (h, r_a6, 'Muhammad Farhan Ali',       '03438565294', '81302-0293423-3', 'general', '2026-06-06', 'monthly', 'space_only', 18000, 0,     0, true, false, '[]', 'Father: Faryad Aziz | Due: 1st of month'),
  (h, r_a6, 'Muhammad Talah',            '03140973474', '17201-3787425-9', 'general', '2026-06-18', 'monthly', 'space_only', 18500, 0,  1500, true, false, '[]', 'Father: Deen Muhammad Shah | Due: 15th of month'),

  -- A-7
  (h, r_a7, 'Mohammad Abdullah',         '03037445023', '36601-9156292-1', 'general', '2026-06-30', 'monthly', 'space_only', 12000, 0,     0, true, false, '[]', 'Father: Mohammad Ishaq | Due: 1st of month'),
  (h, r_a7, 'Zeeshan Akram',             '03095150170', '35101-5139671-9', 'general', '2026-06-30', 'monthly', 'space_only', 12000, 0,     0, true, false, '[]', 'Father: Muhammad Akram | Due: 1st of month'),

  -- A-8
  (h, r_a8, 'Yawar Nawaz',               '03125499569', '37405-1921680-1', 'general', '2026-06-03', 'monthly', 'space_only', 20500, 0,     0, true, false, '[]', 'Father: Asghar Nadeem | Due: 1st of month'),
  (h, r_a8, 'Usama Shahid',              '03204743662', '35403-0321539-9', 'general', '2026-02-28', 'monthly', 'space_only', 20000, 0, 10000, true, false, '[]', 'Father: Shahid Anwar | Due: 1st of month'),

  -- B-1
  (h, r_b1, 'Rana Hussain Majeed',       '03227630382', '36301-1574682-9', 'general', '2025-05-23', 'monthly', 'space_only', 20000, 0, 10000, true, false, '[]', 'Father: Abdul Majeed | Due: 1st of month'),
  (h, r_b1, 'Mohammad Anas Rana',        '03234150102', '33301-6552068-5', 'general', '2026-06-21', 'monthly', 'space_only', 12500, 0, 10000, true, false, '[]', 'Father: Nasir Mehmood | Due: 21st of month'),
  (h, r_b1, 'Abdul Wahab Nadeem',        '03157841242', '33301-5684665-3', 'general', '2026-06-21', 'monthly', 'space_only', 12500, 0, 10000, true, false, '[]', 'Father: Mohammad Nadeem Siddique | Due: 21st of month'),

  -- B-2
  (h, r_b2, 'Boo Ali Syed',              '03246961810', '38101-7482323-1', 'general', '2026-05-04', 'monthly', 'space_only', 14500, 0,  5000, true, false, '[]', 'Father: Syed Mohammad Husnain Bukhari | Due: 1st of month'),
  (h, r_b2, 'Syed Ijlal Haider',         '03306844021', '38101-9384456-9', 'general', '2026-05-04', 'monthly', 'space_only', 14500, 0,  5000, true, false, '[]', 'Father: Ansar Abbas Shah | Due: 1st of month'),
  (h, r_b2, 'Syed Hasan Jalal',          '03371471070', '38301-6935186-7', 'general', '2026-06-08', 'monthly', 'space_only', 14500, 0,     0, true, false, '[]', 'Father: Akhtar Hussain Shah | Due: 1st of month'),

  -- B-3
  (h, r_b3, 'Muhammad Hammad',           '03241998951', '31202-8819758-1', 'general', '2024-10-07', 'monthly', 'space_only', 20000, 0, 10000, true, false, '[]', 'Father: Muhammad Farooq | Due: 1st of month'),
  (h, r_b3, 'Muhammad Harris',           '03430711451', '31303-1975524-3', 'general', '2025-10-29', 'monthly', 'space_only', 20000, 0,     0, true, false, '[]', 'Father: Muhammad Sohail Amjad | Due: 1st of month'),

  -- B-4
  (h, r_b4, 'Aamir Raza Sarki',          '03348521367', '55302-0370748-5', 'general', '2026-07-07', 'monthly', 'space_only', 14000, 0, 10000, true, false, '[]', 'Father: Surhab Khan (Late) | Due: 7th of month'),
  (h, r_b4, 'Rizwan Mustafa Khan',       '03286990468', '33202-4639568-9', 'general', '2026-06-14', 'monthly', 'space_only', 20500, 0, 10000, true, false, '[]', 'Father: Ghulam Mustafa Khan | Due: 14th of month'),
  (h, r_b4, 'Masroor Ahmad',             '03068586622', '31304-0231103-3', 'general', '2026-06-07', 'monthly', 'space_only', 12000, 0,  5000, true, false, '[]', 'Father: M Afzal | Due: 1st of month'),

  -- B-5 (CNIC dots corrected; phone 030185422628 may have 1 extra digit)
  (h, r_b5, 'Muhammad Homam',            '030185422628','35103-0166560-7', 'general', '2026-03-25', 'monthly', 'space_only', 14500, 0,     0, true, false, '[]', 'Father: Javid Iqbal | Due: 25th of month | Phone recorded as 030185422628 (12 digits — verify)'),
  (h, r_b5, 'M Zeshan Ahmad',            '03077813949', '38302-4257919-3', 'general', '2023-06-01', 'monthly', 'space_only', 11000, 0,  6500, true, false, '[]', 'Father: Ghulam Rasool | Due: 1st of month'),
  (h, r_b5, 'Ali Raza',                  '03335572577', '37105-6934195-9', 'general', '2026-06-08', 'monthly', 'space_only', 20000, 0,     0, true, false, '[]', 'Father: Nadeem Ahmed Malik | Due: 1st of month'),

  -- B-6
  (h, r_b6, 'Naseem Ullah',              '03138164807', '54201-5673297-1', 'general', '2026-07-06', 'monthly', 'space_only', 20500, 0, 10000, true, false, '[]', 'Father: Bismillah | Due: 1st of month'),
  (h, r_b6, 'Rizwan Ahmad',              '03469817681', '34402-7647467-7', 'general', '2025-08-04', 'monthly', 'space_only', 14000, 0,     0, true, false, '[]', 'Father: Lal Khan | Due: 1st of month'),

  -- B-7
  (h, r_b7, 'Tausif Khan',               '03439274596', '11201-1902262-9', 'general', '2025-08-31', 'monthly', 'space_only', 12000, 0,  3000, true, false, '[]', 'Father: Niamat Ullah Khan | Due: 1st of month'),
  (h, r_b7, 'Wasand',                    '03440324346', '44202-8665267-5', 'general', '2026-05-11', 'monthly', 'space_only', 12500, 0,     0, true, false, '[]', 'Father: Shahdad | Due: 1st of month'),

  -- B-8 (35000 rent, security = 10000 room + 24000 AC)
  (h, r_b8, 'Farhan Chauhdary',          '03299744136', '61101-1769402-5', 'general', '2026-06-15', 'monthly', 'space_only', 35000, 0, 34000, true, false, '[]', 'Father: Adnan Khalid | Due: 1st of month | Security: 10000 room + 24000 AC'),

  -- C-1
  (h, r_c1, 'Muhammad Naeem',            '03452278159', '35303-5389244-3', 'general', '2024-11-20', 'monthly', 'space_only', 14000, 0,  6000, true, false, '[]', 'Father: Sageer Ahmad Kanwal | Due: 20th of month'),
  (h, r_c1, 'Saif Ali',                  '03365383510', '37105-2684850-3', 'general', '2025-09-21', 'monthly', 'space_only', 14000, 0,  5000, true, false, '[]', 'Father: Hamid Mahmood | Due: 20th of month'),

  -- C-2
  (h, r_c2, 'Muhammad Faseeh ur Rehman', '03054530993', '36102-7623702-3', 'general', '2025-08-12', 'monthly', 'space_only', 12000, 0,  5000, true, false, '[]', 'Father: Muhammad Shafiq | Due: 10th of month'),
  (h, r_c2, 'Ahmer Khurshid',            '03247473585', '33100-7222067-1', 'general', '2025-10-14', 'monthly', 'space_only', 12500, 0,     0, true, false, '[]', 'Father: Azher Khurshid | Due: 13th of month');

  -- ============================================================
  -- SYNC HOSTEL TOTAL CAPACITY
  -- ============================================================
  UPDATE hms_hostels
  SET total_capacity = (SELECT COALESCE(SUM(capacity), 0) FROM hms_rooms WHERE hostel_id = h)
  WHERE id = h;

END $$;
