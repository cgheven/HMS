-- Onboarding: Al Rasheed Boys Hostel - Maaz Branch
-- 26 rooms (N.B.R-1 to N.B.R-26) · 44 tenants
-- Data notes applied:
--   N.B.R-8  Saadullah        : due date column missing (data shift) — defaulted to 1st of month
--   N.B.R-13                  : 1 room, capacity 1; tenant has passport P10319387 (foreigner), no phone
--   N.B.R-16                  : 4-bed room, Sr 1 and 3 empty; Sr 2 and 4 occupied
--   N.B.R-22                  : 3 tenants (Rana Arsalan Sr1 + Touqeer Mustafa unlabeled + Farrukh Naeem Sr2)
--   N.B.R-25 Sr3              : "worker Usama" — identified as staff, not a paying tenant; skipped
--   N.B.R-26                  : 1-bed room, empty

DO $$
DECLARE
  h uuid;
  r1  uuid; r2  uuid; r3  uuid; r4  uuid; r5  uuid; r6  uuid; r7  uuid;
  r8  uuid; r9  uuid; r10 uuid; r11 uuid; r12 uuid; r13 uuid; r14 uuid;
  r15 uuid; r16 uuid; r17 uuid; r18 uuid; r19 uuid; r20 uuid; r21 uuid;
  r22 uuid; r23 uuid; r24 uuid; r25 uuid; r26 uuid;
BEGIN
  SELECT id INTO h FROM hms_hostels WHERE name ILIKE '%Al Rasheed%Maaz%' LIMIT 1;
  IF h IS NULL THEN
    RAISE EXCEPTION 'Hostel "Al Rasheed Boys Hostel - Maaz Branch" not found — verify exact name in hms_hostels';
  END IF;

  IF EXISTS (SELECT 1 FROM hms_rooms WHERE hostel_id = h LIMIT 1) THEN
    RAISE EXCEPTION 'Rooms already exist for this hostel — migration likely already applied';
  END IF;

  -- ============================================================
  -- ROOMS  (26 rooms, total capacity 64)
  -- ============================================================

  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'N.B.R-1',  2, 2, 'general', false, false, 0, 'occupied')  RETURNING id INTO r1;

  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'N.B.R-2',  3, 2, 'general', false, false, 0, 'available') RETURNING id INTO r2;

  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'N.B.R-3',  3, 1, 'general', false, false, 0, 'available') RETURNING id INTO r3;

  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'N.B.R-4',  2, 2, 'general', false, false, 0, 'occupied')  RETURNING id INTO r4;

  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'N.B.R-5',  2, 2, 'general', false, false, 0, 'occupied')  RETURNING id INTO r5;

  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'N.B.R-6',  2, 0, 'general', false, false, 0, 'available') RETURNING id INTO r6;

  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'N.B.R-7',  3, 3, 'general', false, false, 0, 'occupied')  RETURNING id INTO r7;

  -- N.B.R-8: 4-bed room, all occupied
  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'N.B.R-8',  4, 4, 'general', false, false, 0, 'occupied')  RETURNING id INTO r8;

  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'N.B.R-9',  3, 3, 'general', false, false, 0, 'occupied')  RETURNING id INTO r9;

  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'N.B.R-10', 2, 2, 'general', false, false, 0, 'occupied')  RETURNING id INTO r10;

  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'N.B.R-11', 3, 3, 'general', false, false, 0, 'occupied')  RETURNING id INTO r11;

  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'N.B.R-12', 2, 1, 'general', false, false, 0, 'available') RETURNING id INTO r12;

  -- N.B.R-13: single-bed room for 1 tenant (foreigner with passport)
  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'N.B.R-13', 1, 1, 'general', false, false, 0, 'occupied')  RETURNING id INTO r13;

  -- N.B.R-14: 3-bed, only Sr 1 occupied
  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'N.B.R-14', 3, 1, 'general', false, false, 0, 'available') RETURNING id INTO r14;

  -- N.B.R-15: 3-bed, only Sr 1 occupied
  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'N.B.R-15', 3, 1, 'general', false, false, 0, 'available') RETURNING id INTO r15;

  -- N.B.R-16: 4-bed room, Sr 1 & 3 empty, Sr 2 & 4 occupied
  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'N.B.R-16', 4, 2, 'general', false, false, 0, 'available') RETURNING id INTO r16;

  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'N.B.R-17', 3, 2, 'general', false, false, 0, 'available') RETURNING id INTO r17;

  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'N.B.R-18', 2, 2, 'general', false, false, 0, 'occupied')  RETURNING id INTO r18;

  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'N.B.R-19', 2, 2, 'general', false, false, 0, 'occupied')  RETURNING id INTO r19;

  -- N.B.R-20: 3-bed, all empty
  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'N.B.R-20', 3, 0, 'general', false, false, 0, 'available') RETURNING id INTO r20;

  -- N.B.R-21: single-bed room
  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'N.B.R-21', 1, 1, 'general', false, false, 0, 'occupied')  RETURNING id INTO r21;

  -- N.B.R-22: 3 tenants (Sr 1, unlabeled, Sr 2)
  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'N.B.R-22', 3, 3, 'general', false, false, 0, 'occupied')  RETURNING id INTO r22;

  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'N.B.R-23', 2, 2, 'general', false, false, 0, 'occupied')  RETURNING id INTO r23;

  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'N.B.R-24', 2, 1, 'general', false, false, 0, 'available') RETURNING id INTO r24;

  -- N.B.R-25: 3-bed; Sr 3 is a worker (non-paying), only Sr 1 is a tenant
  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'N.B.R-25', 3, 1, 'general', false, false, 0, 'available') RETURNING id INTO r25;

  -- N.B.R-26: 1-bed, empty
  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  VALUES (h, 'N.B.R-26', 1, 0, 'general', false, false, 0, 'available') RETURNING id INTO r26;

  -- ============================================================
  -- TENANTS  (44 paying tenants; father name + due day in notes)
  -- ============================================================

  INSERT INTO hms_tenants (
    hostel_id, room_id, full_name, phone, cnic, type,
    check_in, billing_type, package_tier, monthly_rent, daily_rate,
    security_deposit, is_active, is_waiting, documents, notes
  ) VALUES

  -- N.B.R-1
  (h, r1,  'Sardar Hadi Hussain Bali',    '03221003588', '34603-0468431-3', 'general', '2026-01-19', 'monthly', 'space_only', 20000, 0,     0, true, false, '[]', 'Father: Muhammad Ali | Due: 19th of month'),
  (h, r1,  'Noman Husnain',               '03137362445', '38101-8926115-1', 'general', '2024-10-01', 'monthly', 'space_only', 19000, 0, 10000, true, false, '[]', 'Father: Mushtaq Ahmad | Due: 1st of month'),

  -- N.B.R-2
  (h, r2,  'Ahmad Hassan',                '03005810255', '36102-7454754-3', 'general', '2025-06-12', 'monthly', 'space_only', 18000, 0, 10000, true, false, '[]', 'Father: Sajjad Hassan | Due: 12th of month'),
  (h, r2,  'Muhammad Huzaifa',            '03707040784', '34601-1645507-7', 'general', '2025-07-12', 'monthly', 'space_only', 18000, 0,     0, true, false, '[]', 'Father: Aas Muhammad | Due: 12th of month'),

  -- N.B.R-3
  (h, r3,  'Yasir Arfat',                 '03113025077', '44206-4509554-1', 'general', '2025-10-20', 'monthly', 'space_only', 18000, 0,     0, true, false, '[]', 'Father: Abdul Rasheed | Due: 1st of month'),

  -- N.B.R-4
  (h, r4,  'Umer Shahid',                 '03351812140', '32202-9697081-9', 'general', '2026-01-23', 'monthly', 'space_only', 18000, 0,     0, true, false, '[]', 'Father: Muhammad Shahid Iqbal | Due: 22nd of month'),
  (h, r4,  'Ahsen Javaid',                '03046317020', '33102-0450834-7', 'general', '2024-05-20', 'monthly', 'space_only', 20000, 0,     0, true, false, '[]', 'Father: Javeed Iqbal | Due: 20th of month'),

  -- N.B.R-5
  (h, r5,  'Ali Hamza Tarar',             '03410454924', '34301-5295008-3', 'general', '2026-04-02', 'monthly', 'space_only', 14000, 0,     0, true, false, '[]', 'Father: Muhammad Ashraf Tarar | Due: 1st of month'),
  (h, r5,  'Rizwan Ali',                  '03005908012', '42201-7894788-3', 'general', '2025-01-19', 'monthly', 'space_only', 19500, 0,  5000, true, false, '[]', 'Father: Sherbaz Khan | Due: 19th of month'),

  -- N.B.R-7
  (h, r7,  'Waqar Ali',                   '03087222108', '33303-6019188-9', 'general', '2024-12-12', 'monthly', 'space_only', 18000, 0,     0, true, false, '[]', 'Father: Zulfiqar Ali | Due: 10th of month'),
  (h, r7,  'Muhammad Hamas Shahid',       '03007477098', '34101-9830251-3', 'general', '2025-08-10', 'monthly', 'space_only', 12500, 0, 10000, true, false, '[]', 'Father: Shahid Mahmood | Due: 10th of month'),
  (h, r7,  'Muhammad Noman',              '03094558067', '36302-3220794-3', 'general', '2026-05-17', 'monthly', 'space_only', 12000, 0,     0, true, false, '[]', 'Father: Mushtar Ahmad | Due: 15th of month'),

  -- N.B.R-8 (Saadullah: due date missing from source — defaulted to 1st)
  (h, r8,  'Muhammad Adnan',              '03027222663', '33403-0422106-7', 'general', '2024-08-09', 'monthly', 'space_only', 11000, 0,     0, true, false, '[]', 'Father: Mihammad Ishaq | Due: 9th of month'),
  (h, r8,  'Saadullah',                   '03045344586', '36102-6154963-9', 'general', '2026-06-01', 'monthly', 'space_only', 18000, 0,     0, true, false, '[]', 'Father: Muhammad Farooq | Due: 1st of month (due date missing in source, defaulted to 1st)'),
  (h, r8,  'Muhammad Salman Aslam',       '03047777980', '36302-1160294-1', 'general', '2026-03-31', 'monthly', 'space_only', 11000, 0,  5000, true, false, '[]', 'Father: Muhammad Aslam | Due: 1st of month'),
  (h, r8,  'Sajjad Ahmad',                '03099304871', '36302-0723409-7', 'general', '2026-03-31', 'monthly', 'space_only', 11000, 0,  5000, true, false, '[]', 'Father: Ali Ahmad | Due: 1st of month'),

  -- N.B.R-9
  (h, r9,  'Muhammad Aswad Rustam',       '03180402905', '37405-6767345-5', 'general', '2026-01-11', 'monthly', 'space_only', 12000, 0,     0, true, false, '[]', 'Father: Muhammad Rustam Khan | Due: 10th of month'),
  (h, r9,  'Muhammad Ahmad',              '03151858875', '81302-4597153-7', 'general', '2026-01-14', 'monthly', 'space_only', 12000, 0,     0, true, false, '[]', 'Father: Ramzan | Due: 13th of month'),
  (h, r9,  'Usama Ijaz',                  '03142437251', '38403-9708828-5', 'general', '2026-01-14', 'monthly', 'space_only', 12000, 0,     0, true, false, '[]', 'Father: Ejaz Ahmad | Due: 13th of month'),

  -- N.B.R-10
  (h, r10, 'Ibrahim Bhuta',               '03367681667', '33203-7998616-9', 'general', '2025-11-26', 'monthly', 'space_only', 19000, 0,     0, true, false, '[]', 'Father: Muhammad Aslam | Due: 25th of month'),
  (h, r10, 'Ahmad Hussain',               '03315035400', '37405-4470127-3', 'general', '2025-12-06', 'monthly', 'space_only', 14000, 0, 10000, true, false, '[]', 'Father: Nusrat Hussain Rashid | Due: 5th of month'),

  -- N.B.R-11
  (h, r11, 'Waqar Ahmad',                 '03400179319', '15202-7060727-5', 'general', '2023-10-10', 'monthly', 'space_only', 12500, 0,     0, true, false, '[]', 'Father: Sher Arab | Due: 1st of month'),
  (h, r11, 'Shahjahan',                   '03260013034', '34602-7470623-7', 'general', '2025-12-31', 'monthly', 'space_only', 12500, 0,  5000, true, false, '[]', 'Father: Muhammad Bashir | Due: 1st of month'),
  (h, r11, 'Muhammad Sohail',             '03211554987', '31302-8276297-1', 'general', '2026-01-26', 'monthly', 'space_only', 18500, 0,  5000, true, false, '[]', 'Father: Allah Bakhsh | Due: 25th of month'),

  -- N.B.R-12
  (h, r12, 'Amir Mukhtar',                '03476294910', '34202-5274125-7', 'general', '2025-04-04', 'monthly', 'space_only', 18000, 0,  5000, true, false, '[]', 'Father: Mukhtar Ahmad | Due: 1st of month'),

  -- N.B.R-13 (foreigner: passport P10319387 stored in cnic field; no phone)
  (h, r13, 'Muhammad Osman Adum Mahmmed', NULL,          'P10319387',       'general', '2026-01-26', 'monthly', 'space_only', 25000, 0,  5000, true, false, '[]', 'Father: Osman Adum Mohmmed | Due: 25th of month | Passport number stored (no CNIC — foreign national)'),

  -- N.B.R-14
  (h, r14, 'Muhammad Basit',              '03339852424', '32403-9889832-5', 'general', '2025-12-01', 'monthly', 'space_only', 20000, 0,     0, true, false, '[]', 'Father: Abdul Hameed | Due: 1st of month'),

  -- N.B.R-15
  (h, r15, 'Abrar ul Haq',                '03261758194', '31203-3146206-1', 'general', '2024-12-12', 'monthly', 'space_only', 18000, 0, 10000, true, false, '[]', 'Father: Muhammad Idrees | Due: 1st of month'),

  -- N.B.R-16 (Sr 1 and 3 empty; Sr 2 and 4 occupied)
  (h, r16, 'Muhammad Harris',             '03701985956', '36101-3013184-1', 'general', '2024-10-28', 'monthly', 'space_only', 17000, 0,  5000, true, false, '[]', 'Father: Abid Hussain | Due: 1st of month'),
  (h, r16, 'Bilal Ahmad',                 '03117148766', '31205-1917631-9', 'general', '2024-09-22', 'monthly', 'space_only', 14000, 0,     0, true, false, '[]', 'Father: Haji Ahmad | Due: 21st of month'),

  -- N.B.R-17
  (h, r17, 'Muhammad Abdullah',           '03360147144', '34101-5247104-5', 'general', '2026-02-02', 'monthly', 'space_only', 18500, 0,     0, true, false, '[]', 'Father: Muhammad Zubair | Due: 1st of month'),
  (h, r17, 'Mushahid Khursheed',          '03326919014', '32301-7729985-3', 'general', '2026-01-27', 'monthly', 'space_only', 18000, 0, 10000, true, false, '[]', 'Father: Khursheed Husnain | Due: 1st of month'),

  -- N.B.R-18
  (h, r18, 'Rustam Khan',                 '03339577176', '21203-6327785-9', 'general', '2026-06-08', 'monthly', 'space_only', 14000, 0,  5000, true, false, '[]', 'Father: Sher Ali | Due: 1st of month'),
  (h, r18, 'Muhammad Shafiq',             '03119186209', '13101-3115713-1', 'general', '2026-06-08', 'monthly', 'space_only', 14000, 0,  5000, true, false, '[]', 'Father: Abdur Raziq | Due: 1st of month'),

  -- N.B.R-19
  (h, r19, 'Abdullah Waheed',             '03321473694', '34602-5264743-1', 'general', '2025-10-06', 'monthly', 'space_only', 14000, 0, 10000, true, false, '[]', 'Father: Waheed Ahmad | Due: 5th of month'),
  (h, r19, 'Harris Ali',                  '03430559220', '37203-8515759-9', 'general', '2025-10-06', 'monthly', 'space_only', 14000, 0, 10000, true, false, '[]', 'Father: Rashid Ali | Due: 5th of month'),

  -- N.B.R-21
  (h, r21, 'Hafiz Muhammad Shaban Shahid','03334957738', '34101-3802367-1', 'general', '2024-08-19', 'monthly', 'space_only', 25000, 0,  7000, true, false, '[]', 'Father: Shahid Ali Ameen | Due: 22nd of month'),

  -- N.B.R-22 (3 tenants: Sr1, unlabeled, Sr2)
  (h, r22, 'Rana Muhammad Arsalan Dawood','03095964308', '38405-5047506-3', 'general', '2025-07-01', 'monthly', 'space_only', 18000, 0,  2000, true, false, '[]', 'Father: Dawood Khan | Due: 1st of month'),
  (h, r22, 'Touqeer Mustafa',             '03016827734', '36203-9887927-1', 'general', '2025-08-16', 'monthly', 'space_only', 18000, 0, 10000, true, false, '[]', 'Father: Ghulam Mustafa | Due: 15th of month'),
  (h, r22, 'Muhammad Farrukh Naeem',      '03497469421', '36501-1780457-7', 'general', '2025-09-07', 'monthly', 'space_only', 18000, 0,     0, true, false, '[]', 'Father: Muhammad Naeem | Due: 6th of month'),

  -- N.B.R-23
  (h, r23, 'Ali Raza',                    '03046069068', '35403-8785134-5', 'general', '2025-12-06', 'monthly', 'space_only', 20000, 0,     0, true, false, '[]', 'Father: Muhammad Afzal | Due: 5th of month'),
  (h, r23, 'Harris Ahmad',                '03424155551', '35202-8658856-5', 'general', '2025-12-06', 'monthly', 'space_only', 20000, 0,     0, true, false, '[]', 'Father: Ejaz Ahmad | Due: 5th of month'),

  -- N.B.R-24
  (h, r24, 'Muhammad Abdullah',           '03208057025', '81102-6105107-7', 'general', '2025-11-02', 'monthly', 'space_only', 14500, 0,     0, true, false, '[]', 'Father: Waleed Ahmad | Due: 1st of month'),

  -- N.B.R-25
  (h, r25, 'Muhammad Dilshad',            '03052922180', '32203-2274851-3', 'general', '2022-07-01', 'monthly', 'space_only', 14500, 0,     0, true, false, '[]', 'Father: Ghulam Rasool | Due: 1st of month');

  -- ============================================================
  -- SYNC HOSTEL TOTAL CAPACITY
  -- ============================================================
  UPDATE hms_hostels
  SET total_capacity = (SELECT COALESCE(SUM(capacity), 0) FROM hms_rooms WHERE hostel_id = h)
  WHERE id = h;

END $$;
