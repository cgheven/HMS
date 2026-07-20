-- Snapshot the day count on daily-billed payment rows.
--
-- Every other variable charge on hms_payments already records its own inputs:
-- food keeps food_charge, AC keeps both ac_units_consumed AND ac_charge, so a
-- receipt can itemise "142 units x Rs 28/unit" months later without consulting
-- the tenant record. Days were the exception. The day count was computed at
-- sync time, folded into `amount`, and then discarded — nothing on the row said
-- how many days were billed or at what rate.
--
-- Two consequences, both live bugs. First, the Payments page and receipts
-- cannot show "11 days x Rs 500"; the breakdown there derives base rent by
-- subtraction (amount - food - ac - deposit), which silently absorbs any
-- rounding or later edit. Second, every screen that wants the day count has to
-- recompute it from hms_tenants.check_in/check_out — dates that keep moving
-- after the bill is settled. A tenant who extends their stay retroactively
-- changes what last month's *settled* receipt claims to say. That is exactly
-- how the several day-count implementations in this codebase drifted apart.
--
-- Both columns are nullable and purely additive:
--   * Existing rows keep NULL, which reads as "not a daily row" / "billed
--     before this snapshot existed". No backfill — backfilling would have to
--     recompute settled money from mutable tenant dates, the very thing this
--     migration exists to stop.
--   * The migration-082 validation trigger is untouched. It still checks
--     amount >= food_charge + ac_charge + security_deposit_charge and still
--     overwrites amount from monthly_rent for MONTHLY tenants only, preserving
--     the app-supplied amount for daily ones. Nothing here participates in that
--     check, so monthly behaviour is bit-for-bit unchanged.
--
-- Writers: syncMonthAction and markPaymentPaidAction (app/actions/payments.ts)
-- populate both columns for daily tenants and leave them NULL for monthly ones.
-- The day count itself comes from lib/daily-billing.ts (nights convention: the
-- check-out day is not billed, but a stay continuing past month-end bills the
-- month inclusive).

alter table hms_payments
  add column if not exists billed_days       integer,
  add column if not exists daily_rate_billed numeric(10,2);

comment on column hms_payments.billed_days is
  'Nights billed for a daily-rate tenant in for_month. NULL = not a daily row. Snapshot: never recomputed from tenant dates.';

comment on column hms_payments.daily_rate_billed is
  'hms_tenants.daily_rate as it stood when this row was billed. NULL = not a daily row.';

-- ---------------------------------------------------------------------------
-- RULE 2 — pro-rated final month for a MONTHLY tenant.
--
-- The migration-082 trigger owns `amount` for monthly tenants: it unconditionally
-- recomputes amount := monthly_rent + food + ac + deposit on every INSERT and
-- UPDATE. So an app-layer UPDATE that writes a pro-rated `amount` is reverted
-- inside the same statement — the row keeps the full month while the collected
-- cash reflects the discount, and any report summing `amount` overstates revenue.
--
-- Pro-rating therefore cannot be an app-side amount write. It has to be an input
-- the trigger consults. base_rent_override is that input: NULL everywhere today,
-- so the recomputation is unchanged for every existing row and for every monthly
-- tenant whose owner does not opt in. Daily rows never set it — the ELSE branch
-- still derives base rent by subtraction from the app-supplied amount.
alter table hms_payments
  add column if not exists base_rent_override numeric(10,2);

comment on column hms_payments.base_rent_override is
  'Owner-chosen base rent for this row, replacing hms_tenants.monthly_rent in the amount recomputation. Written only by checkout pro-rating (RULE 2). NULL = use the standing monthly_rent.';

alter table hms_payments
  drop constraint if exists hms_payments_base_rent_override_nonneg;
alter table hms_payments
  add constraint hms_payments_base_rent_override_nonneg
  check (base_rent_override is null or base_rent_override >= 0);

CREATE OR REPLACE FUNCTION public.hms_recalculate_payment_amount()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_monthly_rent   numeric(10,2);
  v_billing_type   text;
  v_food_charge    numeric(10,2);
  v_ac_charge      numeric(10,2);
  v_deposit_charge numeric(10,2);
  v_base_rent      numeric(10,2);
  v_total          numeric(10,2);
  v_hostel_id      uuid;
  v_food_rate      numeric(10,2) := 0;
  v_breakfast_rate numeric(10,2) := 0;
  v_lunch_rate     numeric(10,2) := 0;
  v_dinner_rate    numeric(10,2) := 0;
  v_all_meals_rate numeric(10,2) := 0;
  v_food_breakfast boolean := false;
  v_food_lunch     boolean := false;
  v_food_dinner    boolean := false;
  v_addon_sum      numeric(10,2) := 0;
  v_addon_charge   numeric(10,2) := 0;
  v_tier_charge    numeric(10,2) := 0;
BEGIN
  -- Normalise NULLs on the add-on columns
  new.food_charge             := coalesce(new.food_charge, 0);
  new.ac_charge               := coalesce(new.ac_charge, 0);
  new.late_fee                := coalesce(new.late_fee, 0);
  new.ac_units_consumed       := coalesce(new.ac_units_consumed, 0);
  new.security_deposit_charge := coalesce(new.security_deposit_charge, 0);

  -- Enforce non-negative invariants
  IF new.food_charge < 0 THEN
    RAISE EXCEPTION 'food_charge must be >= 0';
  END IF;
  IF new.ac_charge < 0 THEN
    RAISE EXCEPTION 'ac_charge must be >= 0';
  END IF;
  IF new.late_fee < 0 THEN
    RAISE EXCEPTION 'late_fee must be >= 0';
  END IF;
  IF new.ac_units_consumed < 0 THEN
    RAISE EXCEPTION 'ac_units_consumed must be >= 0';
  END IF;
  IF new.security_deposit_charge < 0 THEN
    RAISE EXCEPTION 'security_deposit_charge must be >= 0';
  END IF;

  -- Validate payment_package_tier when supplied (all five tiers)
  IF new.payment_package_tier IS NOT NULL
     AND new.payment_package_tier NOT IN (
       'space_only', 'space_food', 'space_food_ac',
       'space_3meals', 'space_meals_cooler'
     ) THEN
    RAISE EXCEPTION 'invalid payment_package_tier: %', new.payment_package_tier;
  END IF;

  -- Look up canonical billing type, monthly_rent, and food add-on selection from hms_tenants
  SELECT monthly_rent, billing_type, hostel_id,
         coalesce(food_breakfast, false), coalesce(food_lunch, false), coalesce(food_dinner, false)
    INTO v_monthly_rent, v_billing_type, v_hostel_id,
         v_food_breakfast, v_food_lunch, v_food_dinner
    FROM hms_tenants
   WHERE id = new.tenant_id;

  -- Re-derive food charge from the canonical package config rates
  SELECT coalesce(food_monthly_rate, 0),
         coalesce(food_breakfast_rate, 0), coalesce(food_lunch_rate, 0),
         coalesce(food_dinner_rate, 0), coalesce(food_all_meals_rate, 0)
    INTO v_food_rate, v_breakfast_rate, v_lunch_rate, v_dinner_rate, v_all_meals_rate
    FROM hms_package_configs
   WHERE hostel_id = v_hostel_id;

  -- Tier-inclusive food charge (bundled packages — unchanged from before)
  IF new.payment_package_tier IN (
      'space_food', 'space_food_ac', 'space_3meals', 'space_meals_cooler'
  ) THEN
    v_tier_charge := coalesce(v_food_rate, 0);
  ELSE
    v_tier_charge := 0;
  END IF;

  -- Food add-on charge — independent of package tier, mirrors lib/food-addon.ts
  v_addon_sum :=
    (CASE WHEN v_food_breakfast THEN v_breakfast_rate ELSE 0 END) +
    (CASE WHEN v_food_lunch     THEN v_lunch_rate     ELSE 0 END) +
    (CASE WHEN v_food_dinner    THEN v_dinner_rate    ELSE 0 END);

  IF v_food_breakfast AND v_food_lunch AND v_food_dinner AND v_all_meals_rate > 0 THEN
    -- All three selected and a bundle rate exists: charge whichever is
    -- cheaper. When individual rates aren't configured at all (v_addon_sum
    -- is 0 — a "bundle-only" hostel), the bundle rate applies — NOT zero.
    IF v_addon_sum > 0 THEN
      v_addon_charge := LEAST(v_addon_sum, v_all_meals_rate);
    ELSE
      v_addon_charge := v_all_meals_rate;
    END IF;
  ELSE
    v_addon_charge := v_addon_sum;
  END IF;

  new.food_charge := v_tier_charge + v_addon_charge;

  v_food_charge    := new.food_charge;
  v_ac_charge      := new.ac_charge;
  v_deposit_charge := new.security_deposit_charge;

  IF v_billing_type = 'monthly' THEN
    -- RULE 2: an explicit per-row base-rent override (written only by
    -- checkout pro-rating) wins over the tenant's standing monthly_rent.
    -- NULL on every pre-existing row, so untouched rows are bit-for-bit
    -- identical to the previous behaviour.
    v_base_rent := coalesce(new.base_rent_override, v_monthly_rent, 0);
    v_total     := v_base_rent + v_food_charge + v_ac_charge + v_deposit_charge;
    new.amount  := v_total;
  ELSE
    -- For daily tenants: pro-ration is computed in the app layer.
    -- Enforce that amount >= food_charge + ac_charge + security_deposit_charge.
    v_base_rent := new.amount - v_food_charge - v_ac_charge - v_deposit_charge;
    IF v_base_rent < 0 THEN
      RAISE EXCEPTION
        'payment amount (%) is less than the sum of add-on charges food_charge (%) + ac_charge (%) + security_deposit_charge (%)',
        new.amount, v_food_charge, v_ac_charge, v_deposit_charge;
    END IF;
    new.amount := v_base_rent + v_food_charge + v_ac_charge + v_deposit_charge;
  END IF;

  IF new.amount < 0 THEN
    RAISE EXCEPTION 'computed payment amount must be >= 0, got %', new.amount;
  END IF;

  RETURN new;
END;
$function$;

-- The BEFORE INSERT OR UPDATE trigger from 022_security_fixes.sql:170-173 is
-- unchanged and still points at this function; CREATE OR REPLACE swaps the body
-- underneath it. No re-attach needed, and no existing row is rewritten.
