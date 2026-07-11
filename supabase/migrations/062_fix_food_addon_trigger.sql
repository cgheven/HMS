-- Migration 062: Fix hms_recalculate_payment_amount trigger to include the
-- food add-on charge (Breakfast/Lunch/Dinner, independent of package tier).
--
-- Bug: the BEFORE INSERT/UPDATE trigger on hms_payments (migration 038)
-- unconditionally recomputes food_charge from food_monthly_rate + tier
-- membership only, with zero awareness of the new food add-on columns
-- (food_breakfast_rate/food_lunch_rate/food_dinner_rate/food_all_meals_rate
-- on hms_package_configs, food_breakfast/food_lunch/food_dinner on
-- hms_tenants — added in migration 061). Since this trigger fires on every
-- write to hms_payments, it silently overwrote the application-computed
-- food_charge/amount, stripping the add-on charge before the row was ever
-- persisted — no error, no log, the tenant was just never actually billed
-- for meals they selected. Caught in review before this shipped.
--
-- Fix: re-derive the add-on charge in SQL using the exact same rule as
-- lib/food-addon.ts (sum of ticked meals, or the bundle rate if all three
-- are ticked and the bundle is cheaper), and add it to the existing
-- tier-based food charge additively — tier-only hostels see zero change.

CREATE OR REPLACE FUNCTION hms_recalculate_payment_amount()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_monthly_rent   numeric(10,2);
  v_billing_type   text;
  v_food_charge    numeric(10,2);
  v_ac_charge      numeric(10,2);
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
  new.food_charge       := coalesce(new.food_charge, 0);
  new.ac_charge         := coalesce(new.ac_charge, 0);
  new.late_fee          := coalesce(new.late_fee, 0);
  new.ac_units_consumed := coalesce(new.ac_units_consumed, 0);

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

  IF v_food_breakfast AND v_food_lunch AND v_food_dinner
     AND v_all_meals_rate > 0 AND v_all_meals_rate < v_addon_sum THEN
    v_addon_charge := v_all_meals_rate;
  ELSE
    v_addon_charge := v_addon_sum;
  END IF;

  new.food_charge := v_tier_charge + v_addon_charge;

  v_food_charge := new.food_charge;
  v_ac_charge   := new.ac_charge;

  IF v_billing_type = 'monthly' THEN
    v_base_rent := coalesce(v_monthly_rent, 0);
    v_total     := v_base_rent + v_food_charge + v_ac_charge;
    new.amount  := v_total;
  ELSE
    -- For daily tenants: pro-ration is computed in the app layer.
    -- Enforce that amount >= food_charge + ac_charge.
    v_base_rent := new.amount - v_food_charge - v_ac_charge;
    IF v_base_rent < 0 THEN
      RAISE EXCEPTION
        'payment amount (%) is less than the sum of add-on charges food_charge (%) + ac_charge (%)',
        new.amount, v_food_charge, v_ac_charge;
    END IF;
    new.amount := v_base_rent + v_food_charge + v_ac_charge;
  END IF;

  IF new.amount < 0 THEN
    RAISE EXCEPTION 'computed payment amount must be >= 0, got %', new.amount;
  END IF;

  RETURN new;
END;
$$;
