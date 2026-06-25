-- Migration 038: Fix payment tier constraint and trigger for space_3meals / space_meals_cooler
--
-- Problem: Migration 022 created hms_payments_tier_check with only 3 tiers.
-- Migration 027 tried to drop "hms_payments_payment_package_tier_check" (wrong name),
-- leaving the old 3-tier constraint in place. Any space_3meals or space_meals_cooler
-- payment insert throws a constraint violation and produces no billing record.

-- 1. Drop the stale three-tier constraint
ALTER TABLE hms_payments
  DROP CONSTRAINT IF EXISTS hms_payments_tier_check;

-- 2. Recreate with all five tiers
ALTER TABLE hms_payments
  ADD CONSTRAINT hms_payments_tier_check
    CHECK (payment_package_tier IN (
      'space_only', 'space_food', 'space_food_ac',
      'space_3meals', 'space_meals_cooler'
    ));

-- 3. Replace the trigger function to accept all five tiers and derive food_charge correctly
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

  -- Look up canonical billing type and monthly_rent from hms_tenants
  SELECT monthly_rent, billing_type, hostel_id
    INTO v_monthly_rent, v_billing_type, v_hostel_id
    FROM hms_tenants
   WHERE id = new.tenant_id;

  -- Re-derive food_charge from the canonical package config rate
  SELECT coalesce(food_monthly_rate, 0)
    INTO v_food_rate
    FROM hms_package_configs
   WHERE hostel_id = v_hostel_id;

  -- Apply food charge for all food-inclusive tiers
  IF new.payment_package_tier IN (
      'space_food', 'space_food_ac', 'space_3meals', 'space_meals_cooler'
  ) THEN
    new.food_charge := coalesce(v_food_rate, 0);
  ELSE
    new.food_charge := 0;
  END IF;

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
