-- Onboarding: Al Rasheed Boys Hostel - Shahwaiz Branch
-- 32 rooms (R-2..R-30, P-1..P-3; no R-1 in source data) · 47 tenants
-- Edge cases handled:
--   R-5              : marked "Store" — status maintenance, 0 tenants
--   R-12             : marked "Worker" (2 beds) — status maintenance, 0 tenants
--   R-9  Naseem Ahmad: joining date missing — defaulted to today (2026-07-07), flagged in notes
--   R-11             : 3 tenants (Sr1 M Talha + unlabeled Zumurd Ali + Sr2 Tazeem Mehdi)
--   R-17             : 2 tenants (Sr1 Muhammad Hassan + unlabeled Abdul Ghafoor Waris)
--   R-22 Umair Khan  : data almost entirely absent (only security 10000 noted) — added with placeholder, flagged
--   R-25 M Aqeel     : phone "0327892" incomplete, no joining date — placeholder date, flagged
--   R-26             : 3 beds (Sr1 M Zahid + unlabeled Saqib Khan + Sr2=Space)
--   R-28 Aqeel Frnd  : informal name, no CNIC/phone — added as-is with note
--   R-29             : 4-bed room; Sr3=Space, other 3 occupied
--   P-1 Faheem Anwar : same person appears in R-8 (later joining Jan 2026 vs Nov 2025 in P-1)
--                      — P-1 entry skipped (moved to R-8); P-1 set occupied=0
--   P-3              : 2 tenants both unlabeled; Sr1 listed as Space

DO $$
DECLARE
  h uuid;
  rr2  uuid; rr3  uuid; rr4  uuid; rr5  uuid; rr6  uuid; rr7  uuid;
  rr8  uuid; rr9  uuid; rr10 uuid; rr11 uuid; rr12 uuid; rr13 uuid;
  rr14 uuid; rr15 uuid; rr16 uuid; rr17 uuid; rr18 uuid; rr19 uuid;
  rr20 uuid; rr21 uuid; rr22 uuid; rr23 uuid; rr24 uuid; rr25 uuid;
  rr26 uuid; rr27 uuid; rr28 uuid; rr29 uuid; rr30 uuid;
  rp1  uuid; rp2  uuid; rp3  uuid;
BEGIN
  SELECT id INTO h FROM hms_hostels WHERE name ILIKE '%Shahwaiz%' LIMIT 1;
  IF h IS NULL THEN
    RAISE EXCEPTION 'Hostel "Al Rasheed Boys Hostel - Shahwaiz Branch" not found — verify exact name in hms_hostels';
  END IF;

  IF EXISTS (SELECT 1 FROM hms_rooms WHERE hostel_id = h LIMIT 1) THEN
    RAISE EXCEPTION 'Rooms already exist for this hostel — migration likely already applied';
  END IF;

  -- ============================================================
  -- ROOMS  (32 rooms; total capacity 72)
  -- ============================================================
  -- Note: no R-1 in source data

  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'R-2',  2, 2, 'general', false, false, 0, 'occupied')    RETURNING id INTO rr2;

  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'R-3',  3, 3, 'general', false, false, 0, 'occupied')    RETURNING id INTO rr3;

  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'R-4',  4, 0, 'general', false, false, 0, 'available')   RETURNING id INTO rr4;

  -- R-5: storage room
  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'R-5',  1, 0, 'general', false, false, 0, 'maintenance') RETURNING id INTO rr5;

  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'R-6',  2, 2, 'general', false, false, 0, 'occupied')    RETURNING id INTO rr6;

  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'R-7',  2, 1, 'general', false, false, 0, 'available')   RETURNING id INTO rr7;

  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'R-8',  2, 2, 'general', false, false, 0, 'occupied')    RETURNING id INTO rr8;

  -- R-9: single-bed room
  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'R-9',  1, 1, 'general', false, false, 0, 'occupied')    RETURNING id INTO rr9;

  -- R-10: 4-bed; Sr4 blank (space)
  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'R-10', 4, 3, 'general', false, false, 0, 'available')   RETURNING id INTO rr10;

  -- R-11: 3 tenants (Sr1 + unlabeled + Sr2)
  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'R-11', 3, 3, 'general', false, false, 0, 'occupied')    RETURNING id INTO rr11;

  -- R-12: worker room
  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'R-12', 2, 0, 'general', false, false, 0, 'maintenance') RETURNING id INTO rr12;

  -- R-13: 2-bed; Sr1 occupied, Sr2 space
  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'R-13', 2, 1, 'general', false, false, 0, 'available')   RETURNING id INTO rr13;

  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'R-14', 2, 2, 'general', false, false, 0, 'occupied')    RETURNING id INTO rr14;

  -- R-15: 2-bed; Sr1 occupied, Sr2 blank
  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'R-15', 2, 1, 'general', false, false, 0, 'available')   RETURNING id INTO rr15;

  -- R-16: single-bed, space
  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'R-16', 1, 0, 'general', false, false, 0, 'available')   RETURNING id INTO rr16;

  -- R-17: 2 tenants (Sr1 + unlabeled)
  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'R-17', 2, 2, 'general', false, false, 0, 'occupied')    RETURNING id INTO rr17;

  -- R-18: 3 spaces
  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'R-18', 3, 0, 'general', false, false, 0, 'available')   RETURNING id INTO rr18;

  -- R-19: 2-bed; Sr1 blank, Sr2 occupied
  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'R-19', 2, 1, 'general', false, false, 0, 'available')   RETURNING id INTO rr19;

  -- R-20: 3-bed; 2 occupied, Sr3 space
  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'R-20', 3, 2, 'general', false, false, 0, 'available')   RETURNING id INTO rr20;

  -- R-21: 2-bed; Sr1 occupied, Sr2 space
  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'R-21', 2, 1, 'general', false, false, 0, 'available')   RETURNING id INTO rr21;

  -- R-22: 2-bed; Umair Khan data incomplete but included
  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'R-22', 2, 2, 'general', false, false, 0, 'occupied')    RETURNING id INTO rr22;

  -- R-23: 2-bed; Sr1 occupied, Sr2 space
  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'R-23', 2, 1, 'general', false, false, 0, 'available')   RETURNING id INTO rr23;

  -- R-24: single-bed
  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'R-24', 1, 1, 'general', false, false, 0, 'occupied')    RETURNING id INTO rr24;

  -- R-25: 2-bed; Muhammad Aqeel data incomplete but included
  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'R-25', 2, 2, 'general', false, false, 0, 'occupied')    RETURNING id INTO rr25;

  -- R-26: 3-bed (Sr1 M Zahid + unlabeled Saqib + Sr2=Space)
  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'R-26', 3, 2, 'general', false, false, 0, 'available')   RETURNING id INTO rr26;

  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'R-27', 2, 2, 'general', false, false, 0, 'occupied')    RETURNING id INTO rr27;

  -- R-28: 3-bed; 2 occupied (including informal "Aqeel Frnd"), Sr3 space
  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'R-28', 3, 2, 'general', false, false, 0, 'available')   RETURNING id INTO rr28;

  -- R-29: 4-bed; Sr1,2,4 occupied; Sr3 space
  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'R-29', 4, 3, 'general', false, false, 0, 'available')   RETURNING id INTO rr29;

  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'R-30', 3, 3, 'general', false, false, 0, 'occupied')    RETURNING id INTO rr30;

  -- P-1: Faheem Anwar moved to R-8 (later joining Jan 2026); P-1 left empty
  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'P-1',  1, 0, 'general', false, false, 0, 'available')   RETURNING id INTO rp1;

  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'P-2',  1, 0, 'general', false, false, 0, 'available')   RETURNING id INTO rp2;

  -- P-3: 3-bed; 2 unlabeled tenants + Sr1=Space
  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'P-3',  3, 2, 'general', false, false, 0, 'available')   RETURNING id INTO rp3;

  -- ============================================================
  -- TENANTS  (47 tenants; father name + due day in notes)
  -- ============================================================

  INSERT INTO hms_tenants (
    hostel_id, room_id, full_name, phone, cnic, type,
    check_in, billing_type, package_tier, monthly_rent, daily_rate,
    security_deposit, is_active, is_waiting, documents, notes
  ) VALUES

  -- R-2
  (h, rr2,  'Shabir Ahmad',               '03344333825', '51201-9124432-1', 'general', '2026-06-06', 'monthly', 'space_only', 14500, 0,  8000, true, false, '[]', 'Father: Muhammad Ibrahim | Due: 1st of month'),
  (h, rr2,  'Muhammad Salman',            '03022432282', '51201-3887944-5', 'general', '2026-06-06', 'monthly', 'space_only', 14500, 0,     0, true, false, '[]', 'Father: Aman Ullah | Due: 1st of month'),

  -- R-3
  (h, rr3,  'Qatadah',                    '03144098260', '13101-6624804-7', 'general', '2024-04-19', 'monthly', 'space_only', 16000, 0,     0, true, false, '[]', 'Father: Muhammad Junid | Due: 1st of month'),
  (h, rr3,  'Muhammad Kashif',            '03486841565', '36304-8639260-3', 'general', '2024-12-11', 'monthly', 'space_only', 16000, 0,  5000, true, false, '[]', 'Father: Muhammad Ashraf | Due: 10th of month'),
  (h, rr3,  'Muzamil',                    '03024951827', '38402-7218181-7', 'general', '2022-07-30', 'monthly', 'space_only', 16000, 0,     0, true, false, '[]', 'Father: Ghulam Jillani | Due: 1st of month'),

  -- R-6
  (h, rr6,  'Muhammad Farhan Khan',       '03059632968', '36302-2421552-9', 'general', '2025-01-20', 'monthly', 'space_only', 17000, 0,     0, true, false, '[]', 'Father: Muhammad Aslam Shaheen Shaeed | Due: 20th of month'),
  (h, rr6,  'Muhammad Ahmad Jameel',      '03046160331', '36603-6536020-9', 'general', '2025-06-17', 'monthly', 'space_only', 18500, 0,     0, true, false, '[]', 'Father: M Jameel Mujahid | Due: 17th of month'),

  -- R-7
  (h, rr7,  'Umair Nabeel',               '03275153203', '90403-0193992-5', 'general', '2025-08-27', 'monthly', 'space_only', 14500, 0, 10000, true, false, '[]', 'Father: Khalid Nabeel | Due: 27th of month'),

  -- R-8 (Faheem Anwar: previously in P-1 Nov 2025, moved here Jan 2026)
  (h, rr8,  'Faheem Anwar',               '03113382410', '45402-5378068-3', 'general', '2026-01-18', 'monthly', 'space_only', 14000, 0,     0, true, false, '[]', 'Father: Muhammad Anwar Ali | Due: 8th of month | Previously in P-1 (joined Nov 2025) — moved to R-8 Jan 2026'),
  (h, rr8,  'Muhammad Fozan Bin Mohsin',  '03319187340', '37405-8164614-1', 'general', '2025-08-24', 'monthly', 'space_only', 18000, 0,  5000, true, false, '[]', 'Father: Mohsin Ayub | Due: 27th of month'),

  -- R-9 (joining date missing in source — today used as placeholder)
  (h, rr9,  'Naseem Ahmad',               '03078284045', '36302-1387117-1', 'general', '2026-07-07', 'monthly', 'space_only', 15000, 0,     0, true, false, '[]', 'Father: Muhammad Suhail | Due: 1st of month | Joining date missing in source — 2026-07-07 used as placeholder'),

  -- R-10
  (h, rr10, 'Ali Kassan',                 '03298145593', '34502-4984963-9', 'general', '2025-02-02', 'monthly', 'space_only', 13000, 0,     0, true, false, '[]', 'Father: Abdul Shakoor | Due: 1st of month'),
  (h, rr10, 'Muhammad Ikhlaq Mushtaq',    '03225583603', '34502-6417157-5', 'general', '2025-02-02', 'monthly', 'space_only', 13000, 0,     0, true, false, '[]', 'Father: Muhammad Mushtaq Razvi | Due: 1st of month'),
  (h, rr10, 'Faisal Hafeez',              '03277484320', '36103-3286278-9', 'general', '2025-05-13', 'monthly', 'space_only', 13000, 0, 10000, true, false, '[]', 'Father: Abdul Hafeez | Due: 13th of month'),

  -- R-11 (Sr1 + unlabeled + Sr2)
  (h, rr11, 'M Talha Khan Niazi',         '03344681070', '38101-4579326-7', 'general', '2025-10-07', 'monthly', 'space_only', 25000, 0,     0, true, false, '[]', 'Father: Tariq Nawaz Khan | Due: 6th of month'),
  (h, rr11, 'Zumurd Ali',                 '03215811575', '38302-8501118-1', 'general', '2025-08-31', 'monthly', 'space_only', 18500, 0,     0, true, false, '[]', 'Father: Ghulam Hassan | Due: 1st of month'),
  (h, rr11, 'Tazeem Mehdi',               '03328174572', '38302-4382630-3', 'general', '2025-08-31', 'monthly', 'space_only', 18500, 0,     0, true, false, '[]', 'Father: Sajjad Hussain | Due: 1st of month'),

  -- R-13
  (h, rr13, 'Hafiz Ali Raza',             '03077030303', '42401-3964032-9', 'general', '2025-12-30', 'monthly', 'space_only', 13500, 0,     0, true, false, '[]', 'Father: Muhammad Farooq | Due: 1st of month'),

  -- R-14
  (h, rr14, 'Kashif Ahmad',               '03190371604', '12101-9661694-9', 'general', '2026-02-01', 'monthly', 'space_only', 19000, 0,  3000, true, false, '[]', 'Father: Ahmad Gul | Due: 1st of month'),
  (h, rr14, 'Maaz Zubair',                '03186211962', '36302-6907524-7', 'general', '2026-02-02', 'monthly', 'space_only', 18000, 0,     0, true, false, '[]', 'Father: Zubair Rasheed | Due: 1st of month'),

  -- R-15
  (h, rr15, 'Hasnain Shahzad',            '03065501490', '35403-3416754-7', 'general', '2025-12-21', 'monthly', 'space_only', 14000, 0,     0, true, false, '[]', 'Father: Muhammad Nawaz Ali | Due: 20th of month'),

  -- R-17 (Sr1 + unlabeled)
  (h, rr17, 'Muhammad Hassan',            '03098048529', '33102-1394321-7', 'general', '2026-01-25', 'monthly', 'space_only', 14000, 0, 10000, true, false, '[]', 'Father: Muhammad Ishfaq | Due: 25th of month'),
  (h, rr17, 'Abdul Ghafoor Waris',        '03313434992', '34501-1452705-7', 'general', '2025-08-04', 'monthly', 'space_only', 14000, 0, 10000, true, false, '[]', 'Father: Asif Mehmood Waris | Due: 1st of month'),

  -- R-19 (Sr1 blank, Sr2 occupied)
  (h, rr19, 'Muhammad Waleed',            '03224155847', '35102-9853236-5', 'general', '2024-05-03', 'monthly', 'space_only', 13000, 0,  5000, true, false, '[]', 'Father: Sheikh M Munir Tahir | Due: 1st of month'),

  -- R-20
  (h, rr20, 'Salman Samar',               '03038431799', '34201-7992094-1', 'general', '2025-09-24', 'monthly', 'space_only', 12500, 0,     0, true, false, '[]', 'Father: Samar Iqbal | Due: 23rd of month'),
  (h, rr20, 'Muneeb Khan',                '03080769170', '35301-1394327-9', 'general', '2024-08-08', 'monthly', 'space_only', 11000, 0,  5000, true, false, '[]', 'Father: Shahid Nawaz | Due: 8th of month'),

  -- R-21
  (h, rr21, 'Zaheer Ali',                 '03086186087', '34602-4382873-3', 'general', '2025-10-23', 'monthly', 'space_only', 14500, 0,     0, true, false, '[]', 'Father: Muhammad Ameen | Due: 22nd of month'),

  -- R-22 (Umair Khan: only security 10000 recorded, all other fields missing)
  (h, rr22, 'Nawab Muhammad Umar',        '03360727635', '32403-7763323-7', 'general', '2025-12-03', 'monthly', 'space_only', 12500, 0,     0, true, false, '[]', 'Father: Nusrullha Nawab Khan | Due: 1st of month'),
  (h, rr22, 'Umair Khan',                 NULL,          NULL,              'general', '2026-07-07', 'monthly', 'space_only',     0, 0, 10000, true, false, '[]', 'Data incomplete — no father name, CNIC, phone, joining date, or rent recorded; security 10000 noted | Verify with owner'),

  -- R-23
  (h, rr23, 'Muhammad Zahid Afzal Awan',  '03215883221', '42101-1319665-5', 'general', '2024-04-29', 'monthly', 'space_only', 18000, 0,     0, true, false, '[]', 'Father: Muhammad Afzal Awan | Due: 1st of month'),

  -- R-24
  (h, rr24, 'Muhammad Azeem',             '03455768234', '34401-7202612-1', 'general', '2021-06-06', 'monthly', 'space_only', 16000, 0,  5000, true, false, '[]', 'Father: Mubarak Ali | Due: 1st of month'),

  -- R-25 (Muhammad Aqeel: phone incomplete "0327892", no joining date)
  (h, rr25, 'Hassan Nawaz',               '03042545093', '34302-9735755-7', 'general', '2025-08-13', 'monthly', 'space_only', 13500, 0,     0, true, false, '[]', 'Father: Arif Nawaz | Due: 1st of month'),
  (h, rr25, 'Muhammad Aqeel',             '0327892',     '34502-5538627-7', 'general', '2026-07-07', 'monthly', 'space_only',     0, 0,     0, true, false, '[]', 'Father: Muhammad Latif | Phone "0327892" is incomplete (truncated) | Joining date missing — 2026-07-07 used as placeholder | Rent unknown — verify with owner'),

  -- R-26 (Sr1 + unlabeled; Sr2=Space)
  (h, rr26, 'Muhammad Zahid Riaz',        '03406620611', '38302-0341297-5', 'general', '2025-08-31', 'monthly', 'space_only', 18500, 0,     0, true, false, '[]', 'Father: Muhammad Riaz | Due: 1st of month'),
  (h, rr26, 'Saqib Khan',                 '03461656795', '38302-8101760-1', 'general', '2025-09-01', 'monthly', 'space_only', 18500, 0,     0, true, false, '[]', 'Father: Rehmatullah Khan | Due: 1st of month'),

  -- R-27
  (h, rr27, 'Muhammad Numan Asghar',      '03070497958', '13302-2142757-3', 'general', '2025-12-09', 'monthly', 'space_only', 14000, 0,  5000, true, false, '[]', 'Father: Asghar Ali | Due: 8th of month'),
  (h, rr27, 'Ahmed Haseeb',               '03105357774', '37105-2459922-3', 'general', '2026-02-15', 'monthly', 'space_only', 14000, 0,  5000, true, false, '[]', 'Father: Ghulam Safdar | Due: 15th of month'),

  -- R-28 (M Aqeel Haider: no father/CNIC; Aqeel Frnd: informal name, no phone/CNIC)
  (h, rr28, 'M Aqeel Haider',             '03072515876', NULL,              'general', '2023-06-01', 'monthly', 'space_only', 15000, 0,  6500, true, false, '[]', 'Father: not recorded | CNIC not recorded | Due: 1st of month'),
  (h, rr28, 'Aqeel Frnd',                 NULL,          NULL,              'general', '2024-10-01', 'monthly', 'space_only', 15000, 0,     0, true, false, '[]', 'Informal name — friend of M Aqeel Haider | No CNIC or phone recorded | Due: 1st of month | Verify with owner'),

  -- R-29 (Sr1, Sr2, Sr4 occupied; Sr3=Space)
  (h, rr29, 'Muhammad Talha Awais',       '03214026781', '38302-0947103-7', 'general', '2025-09-12', 'monthly', 'space_only', 18500, 0,     0, true, false, '[]', 'Father: Ghulam Yasin | Due: 1st of month'),
  (h, rr29, 'Muhammad Ahsen Zia Sanwal',  '03035253965', '38302-5747253-3', 'general', '2025-08-31', 'monthly', 'space_only', 18500, 0,     0, true, false, '[]', 'Father: Muhammad Zia Ullah | Due: 1st of month'),
  (h, rr29, 'Muhammad Junaid Iqbal',      '03354726143', '32304-9438335-9', 'general', '2025-07-29', 'monthly', 'space_only', 15000, 0,  2500, true, false, '[]', 'Father: Muhammad Iqbal | Due: 29th of month'),

  -- R-30
  (h, rr30, 'Muhammad Waris Hussain',     '03081034066', '38302-9955768-1', 'general', '2025-08-31', 'monthly', 'space_only', 18500, 0,     0, true, false, '[]', 'Father: Ghulam Hussain | Due: 1st of month'),
  (h, rr30, 'Muhammad Bilal',             '03358679081', '38302-2588140-3', 'general', '2025-08-31', 'monthly', 'space_only', 18500, 0,     0, true, false, '[]', 'Father: Nawab Khan | Due: 1st of month'),
  (h, rr30, 'Awais Khan',                 '03063555411', '38302-0130365-5', 'general', '2025-08-31', 'monthly', 'space_only', 18500, 0,     0, true, false, '[]', 'Father: Haqdad Khan | Due: 1st of month'),

  -- P-3 (2 unlabeled tenants; explicit Sr1=Space; Faheem Anwar's P-1 entry skipped — he is in R-8)
  (h, rp3,  'Amir Ali Amin',              '03120648892', '31104-8777129-1', 'general', '2025-09-07', 'monthly', 'space_only', 17000, 0,     0, true, false, '[]', 'Father: M Amin Javeed | Due: 7th of month'),
  (h, rp3,  'Muhammad Abdullah',          '03154779464', '36302-7505830-3', 'general', '2025-10-24', 'monthly', 'space_only', 12000, 0,     0, true, false, '[]', 'Father: Muhammad Ayub | Due: 5th of month');

  -- ============================================================
  -- SYNC HOSTEL TOTAL CAPACITY
  -- ============================================================
  UPDATE hms_hostels
  SET total_capacity = (SELECT COALESCE(SUM(capacity), 0) FROM hms_rooms WHERE hostel_id = h)
  WHERE id = h;

END $$;
