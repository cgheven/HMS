-- Onboarding: Continental Boys Hostel (714-DJT) — tenant data import
-- Source: /Users/musab.khan/Desktop/714-DJT.xlsx (110 rows: 105 ACTIVE, 5 EXPIRED)
--
-- SCOPE: only the 105 ACTIVE tenants are imported. The 5 EXPIRED rows have
-- Pending Amount 0 (fully settled) and their room/bed is not reused by any
-- other row — they represent closed, pre-onboarding history with nothing
-- currently owed or occupied, consistent with every prior onboarding migration
-- in this repo, none of which import churned tenants.
--
-- ROOMS: the sheet only lists Name + "Room No" (e.g. "21-C") for occupied beds.
-- Room number = the numeric part; bed letter = the seat within it. Capacity is
-- set to the number of DISTINCT occupied beds seen for that room number in this
-- sheet — there is no data on any additional vacant beds, so this is a floor,
-- not a guarantee. The owner should raise a room's capacity in Rooms settings if
-- it actually has empty beds beyond what is reflected here.
--
-- MONEY: only "Amount" (monthly_rent) and "Pending Amount" existed on the sheet
-- — no phone, CNIC, or security deposit for ANY of the 105 tenants. Contact info
-- is left NULL; WhatsApp reminders and receipts cannot reach these tenants until
-- the owner adds phone numbers. Security deposit defaults to 0 for all.
--
-- 30 tenants carry a Pending Amount (sum 336,290, matching the sheet's own Total
-- Pending). Each becomes ONE lump-sum opening-balance bill for 2026-08
-- (via base_rent_override, so it is not tied to any single month's normal rent),
-- status 'overdue' so ensureMonthlyPaymentRows never rewrites it on sync. This
-- represents money owed from before this branch existed in the system as one
-- migrated balance, not a month-by-month reconstruction the source data cannot
-- support. September's normal rent bill is left for the app's own monthly sync
-- to create fresh, exactly as for any other tenant.
--
-- KNOWN CONFLICT, flagged in both tenants' notes below: room 4 bed D is claimed
-- by BOTH Abdullah Irshad and Muhammad Nasrullah in the source sheet. Both are
-- imported as-is (room 4, capacity 2) — confirm with the owner which bed each
-- actually occupies.

DO $$
DECLARE
  h uuid := '008090c7-9315-419d-90c2-df9d7bf2cd58'::uuid; -- Continental Boys Hostel (714-DJT)
BEGIN
  IF NOT EXISTS (SELECT 1 FROM hms_hostels WHERE id = h) THEN
    RAISE EXCEPTION 'Hostel id % not found', h;
  END IF;

  IF EXISTS (SELECT 1 FROM hms_rooms WHERE hostel_id = h LIMIT 1) THEN
    RAISE EXCEPTION 'Rooms already exist for this hostel — migration likely already applied';
  END IF;

  -- ============================================================
  -- ROOMS
  -- ============================================================
  INSERT INTO hms_rooms (hostel_id, room_number, capacity, occupied, type, has_ac, has_cooler, monthly_rent, status)
  SELECT h, v.room_number, v.capacity, v.capacity, 'general', false, false, 0, 'occupied'
  FROM (VALUES
    ('1', 4),
    ('2', 2),
    ('3', 2),
    ('4', 3),
    ('5', 3),
    ('6', 3),
    ('7', 1),
    ('9', 3),
    ('10', 3),
    ('11', 3),
    ('12', 2),
    ('13', 3),
    ('14', 3),
    ('15', 3),
    ('16', 3),
    ('18', 4),
    ('19', 4),
    ('20', 3),
    ('21', 3),
    ('22', 2),
    ('23', 3),
    ('24', 4),
    ('25', 4),
    ('26', 3),
    ('29', 1),
    ('30', 4),
    ('32', 1),
    ('36', 2),
    ('37', 3),
    ('39', 2),
    ('40', 2),
    ('41', 3),
    ('42', 4),
    ('43', 3),
    ('44', 2),
    ('45', 2),
    ('46', 1),
    ('48', 1),
    ('49', 2),
    ('50', 1),
    ('51', 2)
  ) AS v(room_number, capacity);

  -- ============================================================
  -- TENANTS (105 active)
  -- ============================================================
  INSERT INTO hms_tenants (
    hostel_id, room_id, full_name, bed_number, type, check_in,
    billing_type, package_tier, monthly_rent, security_deposit,
    registration_fee, is_active, is_waiting, documents, notes
  )
  SELECT
    h, r.id, v.full_name, v.bed_number, 'general', v.check_in,
    'monthly', 'space_only', v.monthly_rent, 0,
    0, true, false, '[]', v.notes
  FROM (VALUES
    ('7', 'Umer Bilal Jawinda', 'B', 17500, '2026-08-01'::date, NULL),
    ('4', 'Abdul Rehman', 'C', 17500, '2026-08-01'::date, NULL),
    ('51', 'Hassan Ali', 'B', 20000, '2026-08-01'::date, NULL),
    ('42', 'Muhammad Taha', 'D', 17000, '2026-08-01'::date, 'Room normalized from source value "-42D" to 42-D'),
    ('16', 'Mr Ameer', 'C', 22500, '2026-08-01'::date, NULL),
    ('25', 'Muhammad Arslan', 'A', 12000, '2026-08-01'::date, NULL),
    ('24', 'Ali Azad', 'C', 12500, '2026-07-01'::date, NULL),
    ('49', 'Noor Ul Islam', 'B', 20000, '2026-08-01'::date, NULL),
    ('44', 'Mr. Arham Nazir', 'A', 20000, '2026-08-01'::date, NULL),
    ('49', 'Waseem Shahzd', 'C', 20000, '2026-08-01'::date, NULL),
    ('26', 'Muhammad Bilal', 'C', 18000, '2026-08-01'::date, NULL),
    ('13', 'Zaid Habib', 'C', 16500, '2026-08-01'::date, NULL),
    ('5', 'Mr Zain', 'B', 11500, '2026-08-01'::date, NULL),
    ('23', 'Haider', 'C', 12000, '2026-08-01'::date, NULL),
    ('13', 'Zain Ul Abideen', 'B', 15500, '2026-08-01'::date, NULL),
    ('45', 'Obaid Naveed', 'A & B', 42000, '2026-07-01'::date, 'Occupies both beds A and B in room 45 alone (source listed as one combined booking)'),
    ('40', 'Muneeb Khurshid', 'A', 16500, '2026-07-22'::date, NULL),
    ('4', 'Abdullah Irshad', 'D', 17500, '2026-08-01'::date, 'CONFLICT: bed 4-D also claimed by Muhammad Nasrullah in source sheet — confirm actual bed assignment with owner'),
    ('4', 'Muhammad Nasrullah', 'D', 17500, '2026-08-01'::date, 'CONFLICT: bed 4-D also claimed by Abdullah Irshad in source sheet — confirm actual bed assignment with owner'),
    ('46', 'Muhammad Shuja', 'A', 20000, '2026-07-01'::date, NULL),
    ('39', 'Atif Marath', 'B', 20000, '2026-07-01'::date, NULL),
    ('39', 'M Rehan Azeem', 'A', 22000, '2026-07-01'::date, NULL),
    ('23', 'Allah Dino Khan Solangi', 'B', 12500, '2026-07-01'::date, NULL),
    ('23', 'Shahaib Abbas', 'A', 12500, '2026-07-01'::date, NULL),
    ('2', 'Muhammad Ahmad', 'B', 15000, '2026-07-01'::date, NULL),
    ('1', 'Ahmed fareed', 'A', 12500, '2026-07-01'::date, NULL),
    ('5', 'Muhammad Ahmed', 'A', 11000, '2026-07-01'::date, NULL),
    ('20', 'Muhammad Aaylin Haider', 'D', 12500, '2026-07-01'::date, NULL),
    ('24', 'Muhammad Uzair', 'A', 12500, '2026-07-01'::date, NULL),
    ('43', 'Saim Khan Khakwani', 'B', 16000, '2026-07-01'::date, NULL),
    ('21', 'Shoaib Usmani', 'D', 11000, '2026-07-01'::date, NULL),
    ('25', 'Arman Liqat', 'D', 13000, '2026-07-01'::date, NULL),
    ('25', 'Ibrahim Sahi', 'C', 12000, '2026-07-01'::date, NULL),
    ('25', 'Moiz Rana', 'B', 12000, '2026-07-01'::date, NULL),
    ('44', 'Hussain Mohiyudin', 'B', 21500, '2026-07-01'::date, NULL),
    ('1', 'Saim Imran', 'C', 12500, '2026-07-01'::date, NULL),
    ('12', 'Sarmad', 'C', 15000, '2026-07-01'::date, NULL),
    ('13', 'zulnurain', 'A', 17000, '2026-07-01'::date, NULL),
    ('12', 'Muhammad Ali', 'A', 15000, '2026-07-01'::date, NULL),
    ('43', 'Riyan Ali', 'D', 15000, '2026-06-01'::date, NULL),
    ('41', 'Rajab Ali', 'C', 16500, '2026-06-01'::date, '13 June Shifted'),
    ('40', 'M Atif', 'B', 15000, '2026-06-01'::date, NULL),
    ('15', 'uneeb zia', 'C', 12500, '2025-10-01'::date, NULL),
    ('20', 'Mounnem ch', 'B', 11000, '2026-06-01'::date, NULL),
    ('18', 'Ali Abid', 'D', 12500, '2026-06-01'::date, NULL),
    ('5', 'Usman Liaqat', 'D', 12500, '2026-06-01'::date, NULL),
    ('1', 'M Noman Mehboob', 'B', 12500, '2026-06-01'::date, NULL),
    ('30', 'M Haseeb Aslam', 'D', 15000, '2026-06-01'::date, NULL),
    ('30', 'M Umer Daraz', 'C', 15000, '2026-06-01'::date, NULL),
    ('16', 'Noman Ali', 'B', 22500, '2026-05-01'::date, 'shifted from 20 c pia'),
    ('9', 'Bilal Zulfiqar', 'C', 12500, '2026-05-01'::date, NULL),
    ('18', 'Hasham Ahmad', 'A', 13000, '2026-05-01'::date, NULL),
    ('22', 'Abdul Rehman', 'B', 12000, '2026-05-01'::date, NULL),
    ('30', 'Muzamil Maqsood', 'B', 15000, '2026-04-01'::date, NULL),
    ('30', 'Mr Rameez', 'A', 15000, '2026-04-01'::date, NULL),
    ('15', 'Muhammad Umair', 'D', 11500, '2026-04-01'::date, 'shifted on 20th april'),
    ('21', 'Ahmad Malik', 'B', 11000, '2026-04-01'::date, NULL),
    ('36', 'saad Siddqui', 'A', 20000, '2026-04-01'::date, NULL),
    ('18', 'Hamid Noor', 'C', 12500, '2026-04-01'::date, NULL),
    ('43', 'Muhammad Usman', 'C', 15000, '2026-04-01'::date, NULL),
    ('18', 'Mr Ibrahim', 'B', 12000, '2026-02-01'::date, 'Shifted from Room 23'),
    ('24', 'Mr. Shahmeer', 'B', 12500, '2026-02-01'::date, NULL),
    ('22', 'Mr Fashi', 'C', 11000, '2026-01-01'::date, NULL),
    ('1', 'Mr Ibrahim', 'D', 12500, '2026-01-01'::date, NULL),
    ('6', 'Mr Muneeb', 'C', 11000, '2026-01-01'::date, NULL),
    ('6', 'Mr Mehmood', 'B', 11000, '2026-01-01'::date, NULL),
    ('26', 'Muhammad Mudassar', 'B', 16000, '2026-01-01'::date, NULL),
    ('20', 'Mr Ahmed', 'A', 11000, '2026-01-01'::date, NULL),
    ('42', 'Mr Rehman', 'C', 15000, '2026-01-01'::date, NULL),
    ('14', 'Mr Akber', 'D', 15000, '2026-01-01'::date, NULL),
    ('24', 'Zeeshan Bilal', 'D', 12500, '2025-12-21'::date, NULL),
    ('10', 'Mr Waleed', 'A', 15000, '2025-12-01'::date, NULL),
    ('32', 'Mr Ahsan', NULL, 50000, '2025-11-01'::date, NULL),
    ('16', 'Mr Talha', 'A', 22500, '2025-12-01'::date, NULL),
    ('19', 'Mr Zohaib', 'C', 11000, '2025-12-01'::date, NULL),
    ('42', 'Shahzaib jadoon', 'B', 15000, '2025-09-01'::date, NULL),
    ('41', 'Mr Fareed', 'A', 15000, '2025-10-01'::date, NULL),
    ('48', 'Mr Taha', 'A', 15000, '2025-09-20'::date, NULL),
    ('14', 'Mr Malaham', 'C', 15000, '2025-10-01'::date, NULL),
    ('36', 'Mr Rehan', 'B', 21500, '2025-10-01'::date, NULL),
    ('51', 'Tabbasum raza', 'A', 20000, '2026-04-01'::date, NULL),
    ('3', 'Mr Areeb', 'A & B', 34000, '2025-09-01'::date, 'Occupies both beds A and B in room 3 alone (source listed as one combined booking)'),
    ('14', 'Mr Mohsin', 'B', 15000, '2025-08-01'::date, NULL),
    ('42', 'Mr Usama', 'A', 15000, '2025-07-01'::date, NULL),
    ('19', 'Farooq e azam', 'D', 11000, '2025-07-01'::date, NULL),
    ('19', 'Mr Anas', 'A', 11500, '2025-05-01'::date, NULL),
    ('41', 'Moiz Bari', 'B', 15000, '2025-03-01'::date, NULL),
    ('9', 'Mr Abdullah', 'B', 14000, '2025-02-01'::date, NULL),
    ('21', 'Ali Haider', 'A', 11000, '2025-02-01'::date, NULL),
    ('9', 'Mr Ahmad', 'A', 12500, '2025-02-01'::date, NULL),
    ('37', 'Mr Mujtaba', 'B', 15000, '2025-01-01'::date, NULL),
    ('37', 'Mr Gul', 'A', 15500, '2024-12-01'::date, NULL),
    ('15', 'Mr Abbas', 'B', 12000, '2024-10-01'::date, NULL),
    ('6', 'Mr Zohaib', 'D', 11000, '2024-06-01'::date, NULL),
    ('10', 'Mr Haider', 'B', 15000, '2024-05-01'::date, NULL),
    ('2', 'Mr Taheer', 'A', 15000, '2024-02-01'::date, NULL),
    ('11', 'Mr Imran', 'C', 11500, '2024-02-01'::date, NULL),
    ('11', 'Mr Manan', 'D', 11500, '2023-12-01'::date, NULL),
    ('29', 'Mr Ahmad sheraz khan', NULL, 25000, '2023-12-01'::date, NULL),
    ('19', 'Mr Aqib Anwar', 'B', 11500, '2023-12-01'::date, NULL),
    ('10', 'Mr Abu Bakar', 'C', 15000, '2023-12-02'::date, NULL),
    ('37', 'Mr Aftab', 'C', 15000, '2023-12-02'::date, NULL),
    ('11', 'MR Ibrahim', 'B', 11500, '2023-12-01'::date, NULL),
    ('50', 'Salar', NULL, 40000, '2023-12-01'::date, NULL),
    ('26', 'Bajwa', 'A', 15000, '2023-12-01'::date, NULL)
  ) AS v(room_number, full_name, bed_number, monthly_rent, check_in, notes)
  JOIN hms_rooms r ON r.hostel_id = h AND r.room_number = v.room_number;

  -- ============================================================
  -- OPENING BALANCES — 30 tenants carrying a pre-onboarding arrears
  -- balance, as ONE lump-sum bill for 2026-08, status 'overdue' so the
  -- monthly sync (which only ever rewrites a 'pending' row) never touches it.
  -- ============================================================
  INSERT INTO hms_payments (
    hostel_id, tenant_id, for_month, amount, base_rent_override, amount_paid,
    status, payment_package_tier, food_charge, ac_charge, security_deposit_charge,
    registration_fee_charge, referral_discount, notes
  )
  SELECT
    h, t.id, '2026-08', v.pending, v.pending, 0,
    'overdue', 'space_only', 0, 0, 0, 0, 0,
    'Opening balance carried forward from pre-onboarding ledger at the time this branch was set up in Pulse.'
  FROM (VALUES
    ('Ali Azad', '2026-07-01'::date, 5000),
    ('Muhammad Bilal', '2026-08-01'::date, 5000),
    ('Obaid Naveed', '2026-07-01'::date, 18000),
    ('Muneeb Khurshid', '2026-07-22'::date, 16500),
    ('Ahmed fareed', '2026-07-01'::date, 1500),
    ('Shoaib Usmani', '2026-07-01'::date, 11000),
    ('Moiz Rana', '2026-07-01'::date, 2400),
    ('Hussain Mohiyudin', '2026-07-01'::date, 6500),
    ('Riyan Ali', '2026-06-01'::date, 3960),
    ('uneeb zia', '2025-10-01'::date, 89640),
    ('M Noman Mehboob', '2026-06-01'::date, 16730),
    ('Noman Ali', '2026-05-01'::date, 32190),
    ('Hasham Ahmad', '2026-05-01'::date, 22500),
    ('Mr. Shahmeer', '2026-02-01'::date, 5000),
    ('Mr Mehmood', '2026-01-01'::date, 11000),
    ('Mr Akber', '2026-01-01'::date, 2680),
    ('Mr Ahsan', '2025-11-01'::date, 5000),
    ('Mr Taha', '2025-09-20'::date, 10000),
    ('Mr Malaham', '2025-10-01'::date, 11480),
    ('Tabbasum raza', '2026-04-01'::date, 2000),
    ('Mr Mohsin', '2025-08-01'::date, 2680),
    ('Moiz Bari', '2025-03-01'::date, 4000),
    ('Mr Abdullah', '2025-02-01'::date, 3670),
    ('Mr Ahmad', '2025-02-01'::date, 4170),
    ('Mr Mujtaba', '2025-01-01'::date, 1090),
    ('Mr Abbas', '2024-10-01'::date, 2640),
    ('Mr Ahmad sheraz khan', '2023-12-01'::date, 30000),
    ('MR Ibrahim', '2023-12-01'::date, 3960),
    ('Salar', '2023-12-01'::date, 4000),
    ('Bajwa', '2023-12-01'::date, 2000)
  ) AS v(full_name, check_in, pending)
  JOIN hms_tenants t ON t.hostel_id = h AND t.full_name = v.full_name AND t.check_in = v.check_in;

  -- Sync each room's occupied count / status from the tenants just inserted
  -- (belt-and-braces — capacity was already set to match on insert above).
  UPDATE hms_rooms r
  SET occupied = (SELECT count(*) FROM hms_tenants t WHERE t.room_id = r.id AND t.is_active)
  WHERE r.hostel_id = h;

  UPDATE hms_rooms r
  SET status = CASE WHEN r.occupied >= r.capacity THEN 'occupied' ELSE 'available' END
  WHERE r.hostel_id = h;

  -- Branch's stated bed/space capacity, so the public listing and dashboard
  -- reflect the rooms just created.
  UPDATE hms_hostels SET total_capacity = (SELECT coalesce(sum(capacity),0) FROM hms_rooms WHERE hostel_id = h) WHERE id = h;

END $$;
