-- Migration 139: allow fractional AC units
--
-- ac_units_consumed was `integer`, so splitting a room's total meter units
-- equally among tenants had to round each share to a whole unit — a 2-tenant
-- room with 145 total units got billed 73/72 instead of a fair 72.5/72.5.
-- Widening to numeric lets the app split evenly to 2 decimal places instead.
-- Existing `>= 0` and `<= 10000` check constraints remain valid unchanged.

alter table hms_payments
  alter column ac_units_consumed type numeric(10,2) using ac_units_consumed::numeric(10,2);
