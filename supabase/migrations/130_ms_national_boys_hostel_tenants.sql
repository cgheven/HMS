-- Onboarding: Ms National Boys hostel — tenants
--
-- 66 tenants transcribed from 4 photographed registers (source: "Data Onboarding
-- - Queries for Client.txt" + "MS National Boys Hostel - Data Onboarding.xlsx").
--
-- ROOM MAPPING: the registers number rooms plainly as 1-26, with no floor
-- prefix. The rooms already provisioned for this hostel (migration 120) are
-- G-1..G-23 (ground) and F-1..F-28 (first floor). Per-room-number capacity
-- (G-N + F-N) matches ledger occupancy almost exactly for every room, and
-- sums to the hostel's registered total_capacity of 94 — strong evidence that
-- ledger "Room N" refers to the pair {G-N, F-N}, not a single room. Only 14
-- tenants can be confidently placed in a specific physical room: those with an
-- explicit floor note on the register ("1st", "Ground-fl", etc.) or in a
-- ledger room number (25, 26) that only has an F-side counterpart. Every other
-- tenant sharing an ambiguous room number is imported with room_id left NULL
-- and a note naming the two candidate rooms — assign manually once confirmed.
--
-- OTHER DEFAULTS (unknown on every row, not called out per-tenant below):
--   type            = 'general'     (register never recorded Student/Professional)
--   package_tier    = 'space_only'  (register never recorded a package)
--   billing_type    = 'monthly'
-- Per-row notes flag: missing rent (imported as 0), missing check-in
-- (imported as today's date, a placeholder), unreadable CNIC/phone digits,
-- and tenants with no room recorded at all.

DO $$
DECLARE
  h uuid := '514a77a0-167d-48e7-a47d-6b526a766937'; -- Ms National Boys hostel
BEGIN
  IF NOT EXISTS (SELECT 1 FROM hms_hostels WHERE id = h) THEN
    RAISE EXCEPTION 'Hostel id % not found', h;
  END IF;

  IF EXISTS (SELECT 1 FROM hms_tenants WHERE hostel_id = h LIMIT 1) THEN
    RAISE EXCEPTION 'Tenants already exist for this hostel — migration likely already applied';
  END IF;

  INSERT INTO hms_tenants (
    hostel_id, room_id, full_name, phone, cnic, type,
    check_in, billing_type, package_tier, monthly_rent,
    security_deposit, is_active, is_waiting, documents, notes
  )
  SELECT
    h, r.id, v.full_name, v.phone, v.cnic, 'general',
    COALESCE(v.check_in, CURRENT_DATE), 'monthly', 'space_only', COALESCE(v.rent, 0),
    COALESCE(v.deposit, 0), true, false, '[]', v.notes
  FROM (VALUES
  ('F-1', 'M. Kamran', '0342-8899984', '31301-4945845-7', NULL, 3000, '2026-07-23'::date, 'Monthly rent not recorded — imported as 0, confirm with owner'),
  (NULL, 'M. Usama', '0310-5789108', '38202-2953884-?', 23000, NULL, '2026-01-01'::date, 'Ledger Room 1 — actually G-1 or F-1, exact wing not recorded; assign manually | CNIC last digit unreadable on source sheet — confirm against ID card'),
  ('F-1', 'Arshad Khan', '0303-8239113', '17301-8976412-9', 20000, 5000, '2026-06-27'::date, NULL),
  ('F-2', 'Abd-ul-Basit', '0320-9355838', '15701-2677604-3', 20000, NULL, NULL, 'Check-in date not recorded — placeholder (import date) used, confirm with owner'),
  ('F-2', 'Zia-ullah', '0300-7174289', '21104-2559580-3', 20000, NULL, NULL, 'Check-in date not recorded — placeholder (import date) used, confirm with owner'),
  ('F-2', 'Arshad Jamal', '0334-0549284', '14202-7175730-9', 20000, 5000, '2025-10-22'::date, NULL),
  (NULL, 'Talha Umer', '0318-9001863', '16102-3206402-?', 24000, 5000, NULL, 'Ledger Room 3 — actually G-3 or F-3, exact wing not recorded; assign manually | CNIC last digit unreadable on source sheet — confirm against ID card | Check-in date not recorded — placeholder (import date) used, confirm with owner'),
  (NULL, 'Abdul Ghaffar', '0306-3340151', '43407-0513457-7', NULL, 5000, '2026-01-01'::date, 'Ledger Room 4 — actually G-4 or F-4, exact wing not recorded; assign manually | Monthly rent not recorded — imported as 0, confirm with owner'),
  ('F-5', 'M. Salman', '0311-0541293', '17101-8836648-1', 20000, NULL, '2026-01-01'::date, NULL),
  ('F-5', 'Syed Shariq', '0304-1631212', '17201-7825646-5', 20000, 5000, '2026-01-01'::date, NULL),
  (NULL, 'Syed Afaq', NULL, '15702-6781374-9', 20000, NULL, NULL, 'Ledger Room 5 — actually G-5 or F-5, exact wing not recorded; assign manually | Check-in date not recorded — placeholder (import date) used, confirm with owner'),
  (NULL, 'Hasnain', '0340-9476860', '15603-0355332-3', 21000, NULL, NULL, 'Ledger Room 6 — actually G-6 or F-6, exact wing not recorded; assign manually | Check-in date not recorded — placeholder (import date) used, confirm with owner'),
  (NULL, 'M. Nouman', '0304-9494346', '21106-2543649-3', 21000, NULL, NULL, 'Ledger Room 6 — actually G-6 or F-6, exact wing not recorded; assign manually | Check-in date not recorded — placeholder (import date) used, confirm with owner'),
  (NULL, 'Murtaza Ali', '0316-5485503', '16102-3681222-3', NULL, NULL, NULL, 'No room recorded on source ledger | Monthly rent not recorded — imported as 0, confirm with owner | Check-in date not recorded — placeholder (import date) used, confirm with owner'),
  (NULL, 'Azaz Ali', '0312-9627624', '16102-0727117-5', NULL, NULL, NULL, 'No room recorded on source ledger | Monthly rent not recorded — imported as 0, confirm with owner | Check-in date not recorded — placeholder (import date) used, confirm with owner'),
  (NULL, 'Farid Khan', '0346-5310352', '15602-1210916-1', 22000, NULL, '2025-12-03'::date, 'Ledger Room 8 — actually G-8 or F-8, exact wing not recorded; assign manually'),
  (NULL, 'Junaid Khan', '0326-1994003', '17201-3771502-3', 25000, 5000, '2026-05-19'::date, 'Ledger Room 9 — actually G-9 or F-9, exact wing not recorded; assign manually'),
  ('F-10', 'M. Haris', '0318-4908058', '17301-7101573-9', 23000, 5000, '2026-06-09'::date, NULL),
  (NULL, 'Basit Ali', '0327-2025827', '43203-1260752-9', NULL, NULL, NULL, 'Ledger Room 11 — actually G-11 or F-11, exact wing not recorded; assign manually | Monthly rent not recorded — imported as 0, confirm with owner | Check-in date not recorded — placeholder (import date) used, confirm with owner'),
  (NULL, 'Shahabuddin', '0333-8274484', '15607-0485008-7', 25000, 2000, '2026-07-01'::date, 'Ledger Room 12 — actually G-12 or F-12, exact wing not recorded; assign manually'),
  (NULL, 'S. Nadeem', '0313-9866455', '17301-9185034-1', 26000, 5000, '2026-06-18'::date, 'Ledger Room 13 — actually G-13 or F-13, exact wing not recorded; assign manually | Register marks this tenant "Second" floor, which does not match this hostel''s ground/first floor scheme — clarify with owner'),
  (NULL, 'M. Mudassar Khan', '0334-5107821', '11101-7092220-5', NULL, NULL, NULL, 'Ledger Room 14 — actually G-14 or F-14, exact wing not recorded; assign manually | Monthly rent not recorded — imported as 0, confirm with owner | Check-in date not recorded — placeholder (import date) used, confirm with owner'),
  ('F-15', 'M. Usama Hassan', '0310-9576830', '17301-5170963-1', 20000, 5000, '2026-07-20'::date, NULL),
  ('F-15', 'Shahzad Ali', '0313-3292768', '45203-0510820-1', 18000, 5000, NULL, 'Check-in date not recorded — placeholder (import date) used, confirm with owner'),
  (NULL, 'Zahir Ahmed', '0318-4272304', '14901-7837164-3', 20000, 5000, '2026-07-20'::date, 'Ledger Room 16 — actually G-16 or F-16, exact wing not recorded; assign manually'),
  (NULL, 'Siraj Ahmed', '0305-3356415', '41203-5511988-9', 20000, 5000, NULL, 'Ledger Room 16 — actually G-16 or F-16, exact wing not recorded; assign manually | Check-in date not recorded — placeholder (import date) used, confirm with owner'),
  (NULL, 'Fayaz', '0312-8921089', '41203-1877651-3', 20000, NULL, NULL, 'Ledger Room 16 — actually G-16 or F-16, exact wing not recorded; assign manually | Check-in date not recorded — placeholder (import date) used, confirm with owner'),
  (NULL, 'Salman', '0347-7033707', '15302-4976725-1', NULL, 5000, NULL, 'Ledger Room 1 — actually G-1 or F-1, exact wing not recorded; assign manually | Monthly rent not recorded — imported as 0, confirm with owner | Check-in date not recorded — placeholder (import date) used, confirm with owner'),
  (NULL, 'Abid', '0340-9229621', '82202-4359407-?', NULL, 5000, NULL, 'Ledger Room 1 — actually G-1 or F-1, exact wing not recorded; assign manually | CNIC last digit unreadable on source sheet — confirm against ID card | Monthly rent not recorded — imported as 0, confirm with owner | Check-in date not recorded — placeholder (import date) used, confirm with owner'),
  (NULL, 'Yaseen', '0314-5957628', '17301-0962713-9', 24000, 2500, '2026-08-04'::date, 'Ledger Room 2 — actually G-2 or F-2, exact wing not recorded; assign manually'),
  (NULL, 'Waqar Ali', '0336-9075931', '15101-4172272-3', 24000, 5000, '2026-06-17'::date, 'Ledger Room 2 — actually G-2 or F-2, exact wing not recorded; assign manually'),
  (NULL, 'Ahmad', '0323-6959547', '35202-9838323-?', NULL, NULL, NULL, 'No room recorded on source ledger (register marks "G." / ground floor, but no room number given) | CNIC last digit unreadable on source sheet — confirm against ID card | Monthly rent not recorded — imported as 0, confirm with owner | Check-in date not recorded — placeholder (import date) used, confirm with owner'),
  (NULL, 'Jalal', '0355-6089043', '82201-2376964-3', 23000, NULL, '2026-06-20'::date, 'Ledger Room 7 — actually G-7 or F-7, exact wing not recorded; assign manually'),
  (NULL, 'Abdullah', '0348-9645158', NULL, 23000, NULL, '2026-06-10'::date, 'Ledger Room 7 — actually G-7 or F-7, exact wing not recorded; assign manually | No CNIC recorded on source sheet'),
  (NULL, 'Waseem', '0348-8245-87?', '55204-4146583-1', NULL, NULL, NULL, 'Ledger Room 8 — actually G-8 or F-8, exact wing not recorded; assign manually | Phone number partially unreadable on source sheet — confirm with tenant | Monthly rent not recorded — imported as 0, confirm with owner | Check-in date not recorded — placeholder (import date) used, confirm with owner'),
  (NULL, 'Mian Ali', '0317-9914626', '17101-2045577-7', 23000, 5000, '2026-04-06'::date, 'Ledger Room 10 — actually G-10 or F-10, exact wing not recorded; assign manually'),
  (NULL, 'Hussain Ali', '0313-9960302', '17101-4832885-5', 23000, NULL, '2026-05-15'::date, 'Ledger Room 10 — actually G-10 or F-10, exact wing not recorded; assign manually'),
  (NULL, 'Mehsan', '0307-9483247', '43407-0441352-?', 22000, 2500, NULL, 'Ledger Room 14 — actually G-14 or F-14, exact wing not recorded; assign manually | CNIC last digit unreadable on source sheet — confirm against ID card | Check-in date not recorded — placeholder (import date) used, confirm with owner | Register margin marks this row under block "11" but the Room column clearly reads "Rm 14" — 14 used, confirm with owner'),
  (NULL, 'Arbaz Khan Kakar', '0311-2767181', '56202-6573482-5', 24000, NULL, NULL, 'Ledger Room 11 — actually G-11 or F-11, exact wing not recorded; assign manually | Check-in date not recorded — placeholder (import date) used, confirm with owner'),
  ('G-12', 'Khawar Sher', '0347-8591014', '13503-4976870-1', 24000, 5000, '2026-07-06'::date, NULL),
  (NULL, 'Hammad Ahmed', '0302-6779966', '38203-0570995-?', 23000, 5000, '2026-04-02'::date, 'Ledger Room 12 — actually G-12 or F-12, exact wing not recorded; assign manually | CNIC last digit unreadable on source sheet — confirm against ID card'),
  (NULL, 'Adnan Maqsood', '0345-9899951', '22501-4082837-7', 24000, 5000, '2026-06-01'::date, 'Ledger Room 13 — actually G-13 or F-13, exact wing not recorded; assign manually'),
  (NULL, 'Amjad', '0305-837179?', '54400-2669516-9', 24000, NULL, NULL, 'Ledger Room 11 — actually G-11 or F-11, exact wing not recorded; assign manually | Phone number partially unreadable on source sheet — confirm with tenant | Check-in date not recorded — placeholder (import date) used, confirm with owner'),
  (NULL, 'Numan Ali', '0314-9819797', '17201-8528870-7', 23000, NULL, NULL, 'Ledger Room 15 — actually G-15 or F-15, exact wing not recorded; assign manually | Check-in date not recorded — placeholder (import date) used, confirm with owner'),
  (NULL, 'M. Ihtesham', '0323-9978531', '17103-0443762-7', 23000, 3000, NULL, 'Ledger Room 17 — actually G-17 or F-17, exact wing not recorded; assign manually | Check-in date not recorded — placeholder (import date) used, confirm with owner'),
  (NULL, 'Safiullah', '0306-0989990', '15303-0656854-5', 23000, 3000, NULL, 'Ledger Room 17 — actually G-17 or F-17, exact wing not recorded; assign manually | Check-in date not recorded — placeholder (import date) used, confirm with owner'),
  (NULL, 'Nasir', '0335-9575761', '13101-0290876-9', NULL, NULL, NULL, 'No room recorded on source ledger | Monthly rent not recorded — imported as 0, confirm with owner | Check-in date not recorded — placeholder (import date) used, confirm with owner'),
  (NULL, 'Tahir Khan', '0331-6549-6706?', '61101-1985566-1', NULL, NULL, NULL, 'No room recorded on source ledger | Phone number partially unreadable on source sheet — confirm with tenant | Monthly rent not recorded — imported as 0, confirm with owner | Check-in date not recorded — placeholder (import date) used, confirm with owner'),
  (NULL, 'Imran Ullah', '0334-7223893', '12103-7909002-7', 25000, 5000, NULL, 'Ledger Room 19 — actually G-19 or F-19, exact wing not recorded; assign manually | Check-in date not recorded — placeholder (import date) used, confirm with owner'),
  (NULL, 'Sana Ullah', '0343-0031399', '21407-7922642-7', 23000, 5000, NULL, 'Ledger Room 20 — actually G-20 or F-20, exact wing not recorded; assign manually | Check-in date not recorded — placeholder (import date) used, confirm with owner'),
  (NULL, 'Waseem', '0346-3107872?', '12101-1845257-3', 18000, 5000, NULL, 'Ledger Room 16 — actually G-16 or F-16, exact wing not recorded; assign manually | Phone number partially unreadable on source sheet — confirm with tenant | Check-in date not recorded — placeholder (import date) used, confirm with owner'),
  (NULL, 'Ahasan Ali', '0311-1931920', '17101-2710541-1', 20000, 2500, NULL, 'Ledger Room 16 — actually G-16 or F-16, exact wing not recorded; assign manually | Check-in date not recorded — placeholder (import date) used, confirm with owner'),
  (NULL, 'Zulfiqar', '0345-5986741', '71103-3599268-5', 22000, NULL, '2026-06-01'::date, 'Ledger Room 17 — actually G-17 or F-17, exact wing not recorded; assign manually'),
  (NULL, 'M. Saqib', '0320-5606141', '71105-0344350-?', 22000, NULL, '2026-06-01'::date, 'Ledger Room 17 — actually G-17 or F-17, exact wing not recorded; assign manually | CNIC last digit unreadable on source sheet — confirm against ID card'),
  (NULL, 'Shoaib', '0328-8266721', '45404-0497015-1', 23000, NULL, '2026-07-05'::date, 'Ledger Room 17 — actually G-17 or F-17, exact wing not recorded; assign manually'),
  (NULL, 'M. Talha', '0344-0014005', '15607-0401880-?', 25000, NULL, NULL, 'Ledger Room 20 — actually G-20 or F-20, exact wing not recorded; assign manually | CNIC last digit unreadable on source sheet — confirm against ID card | Check-in date not recorded — placeholder (import date) used, confirm with owner'),
  (NULL, 'Anees Hayat', '0343-9393602', '15302-3509136-5', 25000, 5000, NULL, 'Ledger Room 20 — actually G-20 or F-20, exact wing not recorded; assign manually | Check-in date not recorded — placeholder (import date) used, confirm with owner'),
  (NULL, 'Jalal', '0346-9407662', '15302-4182037-3', 25000, 5000, NULL, 'Ledger Room 20 — actually G-20 or F-20, exact wing not recorded; assign manually | Check-in date not recorded — placeholder (import date) used, confirm with owner'),
  (NULL, 'M. Israr', '0349-8086180', '12101-7247451-5', 23000, NULL, NULL, 'Ledger Room 21 — actually G-21 or F-21, exact wing not recorded; assign manually | Check-in date not recorded — placeholder (import date) used, confirm with owner'),
  (NULL, 'Aftab Ali', '0311-9616321', '16102-8811885-5', 23000, 4000, NULL, 'Ledger Room 21 — actually G-21 or F-21, exact wing not recorded; assign manually | Check-in date not recorded — placeholder (import date) used, confirm with owner'),
  (NULL, 'Hanis', '0318-6960875', '14202-8025983-9', 23000, NULL, NULL, 'Ledger Room 21 — actually G-21 or F-21, exact wing not recorded; assign manually | Check-in date not recorded — placeholder (import date) used, confirm with owner'),
  (NULL, 'Javed Rehman', '0300-0948857', '21301-0797970-3', 23000, 1500, '2026-06-05'::date, 'Ledger Room 22 — actually G-22 or F-22, exact wing not recorded; assign manually'),
  (NULL, 'M. Younus Khan', '6369877684?', '21446-1904288-5', 25000, 5000, NULL, 'Ledger Room 23 — actually G-23 or F-23, exact wing not recorded; assign manually | Phone number partially unreadable on source sheet — confirm with tenant | Check-in date not recorded — placeholder (import date) used, confirm with owner'),
  ('F-25', 'M. Eman', '0307-3446797', '41306-2932227-5', 35000, 5000, '2026-04-01'::date, NULL),
  ('F-26', 'Taimoor', '0326-5523990', '37106-0188250-5', 24000, NULL, '2026-07-16'::date, NULL),
  ('F-26', 'Noman', '0313-9377038', '17301-0251194-2', 23000, 5000, '2026-06-01'::date, NULL)
  ) AS v(room_code, full_name, phone, cnic, rent, deposit, check_in, notes)
  LEFT JOIN hms_rooms r ON r.hostel_id = h AND r.room_number = v.room_code;

  -- Sync each room's occupied count / status from the tenants just inserted.
  UPDATE hms_rooms r
  SET occupied = (SELECT count(*) FROM hms_tenants t WHERE t.room_id = r.id AND t.is_active)
  WHERE r.hostel_id = h;

  UPDATE hms_rooms r
  SET status = CASE WHEN r.occupied >= r.capacity THEN 'occupied' ELSE 'available' END
  WHERE r.hostel_id = h;

END $$;
