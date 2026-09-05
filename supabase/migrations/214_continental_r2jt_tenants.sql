-- Onboarding: Continental Boys Hostel (R-2 JT) — tenant data import
-- Source: /Users/musab.khan/Desktop/R-2 JT.xlsx (30 rows: 28 ACTIVE, 2 EXPIRED)
--
-- SCOPE: only the 28 ACTIVE tenants are imported. The 2 EXPIRED rows have
-- Pending Amount 0 and their room is not reused by any other row — closed,
-- pre-onboarding history, consistent with 213_continental_714djt_tenants.sql
-- and every earlier onboarding migration in this repo.
--
-- ROOMS: inferred purely from occupied beds in the sheet (e.g. "4-C" -> Room 4,
-- bed C). Capacity = distinct occupied beds seen per room number — a floor, not
-- a guarantee; raise it in Rooms settings if a room actually has more empty beds.
--
-- MONEY: no phone, CNIC, or security deposit for any of the 28 tenants — the
-- sheet never had those columns. Contact info left NULL; WhatsApp reminders and
-- receipts cannot reach these tenants until phone numbers are added.
--
-- 8 tenants carry a Pending Amount (sum 55,850, matching the sheet exactly).
-- Each becomes ONE lump-sum opening-balance bill for 2026-08 (via
-- base_rent_override), status 'overdue' so ensureMonthlyPaymentRows never
-- rewrites it — same convention as the 714-DJT branch. September's normal rent
-- is left for the app's own monthly sync to create fresh.
--
-- FLAGGED, not resolved:
--   - Room 16 bed C is claimed by BOTH hamza imran and Hafiz Saad — both imported
--     as-is (room 16 capacity 4), noted on each; confirm the real assignment.
--   - Muhammad Faheem: the sheet's own Pending Amount (9,000) disagrees with its
--     own free-text note ("13,000 balance") — imported at 9,000, flagged.
--   - Hussain Ibrar: sheet note suggests the real admission date may be 14 April,
--     not the 1 April in the From column — imported as given (1 April), flagged.

DO $$
DECLARE
  h uuid := 'a1eecec9-4851-4d60-9a01-c9d84a88719b'::uuid; -- Continental Boys Hostel (R-2 JT)
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
    ('1', 2),
    ('2', 2),
    ('3', 2),
    ('4', 3),
    ('5', 2),
    ('6', 1),
    ('7', 3),
    ('8', 3),
    ('9', 1),
    ('10', 1),
    ('11', 3),
    ('13', 1),
    ('14', 2),
    ('16', 4)
  ) AS v(room_number, capacity);

  -- ============================================================
  -- TENANTS (28 active)
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
    ('10', 'Abdullah Faisal', 'B', 23500, '2026-08-01'::date, NULL),
    ('4', 'Muhammad Ahmad', 'C', 15000, '2026-08-01'::date, NULL),
    ('7', 'Saffi Ullah', NULL, 15000, '2026-07-01'::date, 'Source sheet gave no bed letter for this room ("7-") — bed left unspecified'),
    ('4', 'Muhammad Arslan Ahsen', 'A', 13000, '2026-07-01'::date, NULL),
    ('13', 'Muhammad Arslan', 'A', 22500, '2026-07-01'::date, NULL),
    ('1', 'Bilal Zahoor', 'B', 21500, '2026-07-01'::date, NULL),
    ('1', 'Talha Aftab', 'A', 21500, '2026-07-01'::date, NULL),
    ('5', 'samiullah', 'B', 18000, '2026-07-01'::date, NULL),
    ('5', 'sikander ali', 'A', 18000, '2026-07-01'::date, NULL),
    ('6', 'Muhammad Qasim', NULL, 18000, '2026-07-01'::date, 'Source sheet gave no bed letter for this room ("6-") — bed left unspecified'),
    ('3', 'Maaz Butt', 'B', 20000, '2026-07-01'::date, NULL),
    ('2', 'Hasnat Ur Rehman', 'B & A', 35000, '2026-06-01'::date, 'Occupies both beds B and A in room 2 alone (source listed as one combined booking)'),
    ('14', 'Hamza Nazar Ul Haq', 'B & A', 33000, '2026-05-01'::date, 'Occupies both beds B and A in room 14 alone (source listed as one combined booking)'),
    ('11', 'Ali Haider', 'B', 13000, '2026-06-01'::date, NULL),
    ('11', 'Adeel Riaz', 'A', 15000, '2026-06-01'::date, NULL),
    ('9', 'Shahzad Murad', 'B', 33000, '2026-06-01'::date, NULL),
    ('7', 'Umar Mohsin', 'A', 13500, '2026-06-01'::date, NULL),
    ('7', 'Muhammad Awais', 'B', 13500, '2026-06-01'::date, NULL),
    ('11', 'jawad hasan', 'C', 15000, '2026-06-01'::date, NULL),
    ('3', 'M Abdullah', 'C', 20000, '2026-06-01'::date, NULL),
    ('8', 'Muhammad Faheem', 'B', 15500, '2026-05-01'::date, '13,000 balance | Source sheet''s Pending Amount column says Rs 9,000 but its own free-text note says "13,000 balance" — confirm actual amount owed with owner'),
    ('16', 'hamza imran', 'C', 10000, '2026-04-01'::date, 'CONFLICT: bed 16-C also claimed by Hafiz Saad in source sheet — confirm actual bed assignment with owner'),
    ('16', 'Abu bakar', 'A', 10000, '2026-04-01'::date, NULL),
    ('4', 'Hussain Ibrar', 'B', 15000, '2026-04-01'::date, 'reciept py date 14 april ha admissoin ki'),
    ('16', 'Mr Haziq', 'B', 10000, '2026-04-01'::date, NULL),
    ('16', 'Hafiz Saad', 'C', 10000, '2026-04-01'::date, 'CONFLICT: bed 16-C also claimed by hamza imran in source sheet — confirm actual bed assignment with owner'),
    ('8', 'Mr. Ahsan Gujjar', 'A', 14000, '2026-02-01'::date, NULL),
    ('8', 'Mr. Fahad', 'C', 15000, '2026-02-01'::date, NULL)
  ) AS v(room_number, full_name, bed_number, monthly_rent, check_in, notes)
  JOIN hms_rooms r ON r.hostel_id = h AND r.room_number = v.room_number;

  -- ============================================================
  -- OPENING BALANCES — 8 tenants carrying a pre-onboarding arrears balance,
  -- as ONE lump-sum bill for 2026-08, status 'overdue'.
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
    ('Muhammad Ahmad', '2026-08-01'::date, 10000),
    ('Saffi Ullah', '2026-07-01'::date, 23440),
    ('Adeel Riaz', '2026-06-01'::date, 5000),
    ('Umar Mohsin', '2026-06-01'::date, 1890),
    ('Muhammad Awais', '2026-06-01'::date, 1890),
    ('jawad hasan', '2026-06-01'::date, 4300),
    ('Muhammad Faheem', '2026-05-01'::date, 9000),
    ('Mr. Ahsan Gujjar', '2026-02-01'::date, 330)
  ) AS v(full_name, check_in, pending)
  JOIN hms_tenants t ON t.hostel_id = h AND t.full_name = v.full_name AND t.check_in = v.check_in;

  UPDATE hms_rooms r
  SET occupied = (SELECT count(*) FROM hms_tenants t WHERE t.room_id = r.id AND t.is_active)
  WHERE r.hostel_id = h;

  UPDATE hms_rooms r
  SET status = CASE WHEN r.occupied >= r.capacity THEN 'occupied' ELSE 'available' END
  WHERE r.hostel_id = h;

  UPDATE hms_hostels SET total_capacity = (SELECT coalesce(sum(capacity),0) FROM hms_rooms WHERE hostel_id = h) WHERE id = h;

END $$;
