-- Migration 272: optional per-hostel billing date (anchor day) + join-month proration.
--
-- WHY. Today every tenant's due/reminder day is their own check-in day
-- (tenantDueDay = check_in day-of-month), and a mid-month joiner is billed a
-- FULL month for their join month (calcBaseRentServer returns flat monthly_rent).
-- Many hostels instead run a single billing date for everyone (e.g. the 1st) and
-- want a mid-month joiner charged only for the days they actually stayed that
-- month. This adds that as an OPT-IN, per-branch setting. NULL anchor = today's
-- behaviour exactly, so every existing branch is byte-for-byte unchanged until an
-- owner turns it on.
--
-- billing_anchor_day  NULL  -> per-tenant anniversary billing (current behaviour).
--                     1..31 -> the day-of-month the monthly bill is due for EVERY
--                              tenant of the branch (clamped to month length at
--                              runtime via min(day, daysInMonth)). Bills still
--                              cover CALENDAR months; only the due/reminder day and
--                              the join-month proration change.
--
-- bill_leftover_days_separately
--                     true (DEFAULT) -> the join-month partial days get their OWN
--                              bill in the join month, collectable at move-in, then
--                              full months follow. This is the default because most
--                              hostels collect deposit + first payment at move-in,
--                              and it keeps a new tenant VISIBLE in the month they
--                              joined (a merged tenant has no join-month bill at all).
--                     false -> the join-month partial days are MERGED into the
--                              tenant's first full-month bill (one bill, nothing due
--                              until the billing date). For owners who bill purely on
--                              the billing date with no move-in collection.
--
-- first_month_day_rate (on hms_tenants)
--                     Owner-entered per-day rate for the PARTIAL first month only.
--                     Owners charge a premium for short/partial stays, so this is
--                     NOT derived as monthly_rent/30. NULL -> fall back to
--                     monthly_rent/30. Full months always bill monthly_rent.
--                     Only meaningful for monthly tenants under an anchored branch.

SET lock_timeout = '3s';

ALTER TABLE public.hms_hostels
  ADD COLUMN IF NOT EXISTS billing_anchor_day smallint CHECK (billing_anchor_day BETWEEN 1 AND 31),
  ADD COLUMN IF NOT EXISTS bill_leftover_days_separately boolean NOT NULL DEFAULT true;

-- Safety for an environment where an earlier revision of this migration already
-- added the column with DEFAULT false: bring the default and every dormant row
-- (billing_anchor_day IS NULL everywhere, so this column has no billing effect yet)
-- into line with the intended "separate" default.
ALTER TABLE public.hms_hostels ALTER COLUMN bill_leftover_days_separately SET DEFAULT true;
UPDATE public.hms_hostels SET bill_leftover_days_separately = true WHERE billing_anchor_day IS NULL;

ALTER TABLE public.hms_tenants
  ADD COLUMN IF NOT EXISTS first_month_day_rate numeric(10,2) CHECK (first_month_day_rate >= 0);

COMMENT ON COLUMN public.hms_hostels.billing_anchor_day IS
  'Day-of-month the monthly bill is due for every tenant (1..31, clamped to month length). NULL = per-tenant anniversary billing (legacy default).';
COMMENT ON COLUMN public.hms_hostels.bill_leftover_days_separately IS
  'When true, a mid-month joiner''s partial days get their own bill; false (default) merges them into the first full-month bill.';
COMMENT ON COLUMN public.hms_tenants.first_month_day_rate IS
  'Owner-entered per-day rate for the partial first month (premium daily rate). NULL = fall back to monthly_rent/30. Monthly tenants only.';

-- Refresh PostgREST's schema cache so the new columns are readable/writable now.
notify pgrst, 'reload schema';
