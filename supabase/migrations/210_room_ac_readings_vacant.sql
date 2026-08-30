-- A meter reading taken while the room had no tenant.
--
-- DEPLOY ORDER MATTERS. lib/data.ts and lib/portal-data.ts both SELECT
-- recorded_while_vacant, and PostgREST answers an unknown column with 42703 —
-- which lib/data.ts folds into readErr and rethrows, taking the whole Payments
-- page down for every branch. Apply this before the application code, exactly
-- as migrations 204 and 207 document for the same reason.
--
-- Empty rooms could not be metered at all: the AC tab listed only rooms with an
-- active tenant, and both server actions threw "No active tenants found in this
-- room." So consumption by staff, a guest, or lights left on simply had nowhere
-- to go — and, worse, the meter chain broke. The next tenant to move in is
-- billed from the last recorded reading, which predates the vacancy, so they
-- inherit units consumed before they arrived. 214 of 270 active tenants in
-- metered rooms have no joining_meter_reading to protect them from that.
--
-- The units themselves need no new home: hms_room_ac_readings is already keyed
-- on room + month and already holds the absolute meter_reading that becomes the
-- next month's opening. This column exists only to distinguish "recorded while
-- vacant" from a legacy row that happens to have tenant_count 0, so the UI can
-- label it honestly and reports can exclude it from anything tenant-facing.
--
-- The units are the hostel's own cost and carry NO rupee figure anywhere: no
-- hms_payments row, no hms_expenses row, no hms_bills row. The electricity is
-- already captured in full as a utility bill; attaching money here as well
-- would double-count it and overstate cost per resident.

alter table public.hms_room_ac_readings
  add column if not exists recorded_while_vacant boolean not null default false;

comment on column public.hms_room_ac_readings.recorded_while_vacant is
  'Reading taken with no active tenant in the room. Units are the hostel''s own cost — no payment row exists for them.';
