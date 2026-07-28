-- Registration Fee (one-time, per-tenant, non-refundable) and AC Maintenance
-- (recurring monthly, hostel-wide flat rate, auto-applied to any tenant whose
-- room has AC — independent of package tier).
--
-- Purely additive: every new column defaults to 0, so every hostel that never
-- configures either field computes an identical `amount` to before this
-- migration. Registration Fee follows the exact same "app decides timing,
-- trigger just trusts it" pattern already used for security_deposit_charge.
-- AC Maintenance follows the exact same "trigger re-derives it from scratch
-- every time" pattern already used for food_charge (joins hms_tenants +
-- hms_package_configs/hms_rooms inside the trigger, ignoring whatever the app
-- sent) — because it's a pure function of current state (does this tenant's
-- room have AC + what's the hostel's rate), not a historical timing decision.

ALTER TABLE hms_package_configs
  ADD COLUMN IF NOT EXISTS registration_fee numeric NOT NULL DEFAULT 0;
ALTER TABLE hms_package_configs
  ADD COLUMN IF NOT EXISTS ac_maintenance_rate numeric NOT NULL DEFAULT 0;

ALTER TABLE hms_tenants
  ADD COLUMN IF NOT EXISTS registration_fee numeric NOT NULL DEFAULT 0;

ALTER TABLE hms_payments
  ADD COLUMN IF NOT EXISTS registration_fee_charge numeric(10,2) NOT NULL DEFAULT 0;
ALTER TABLE hms_payments
  ADD COLUMN IF NOT EXISTS ac_maintenance_charge numeric(10,2) NOT NULL DEFAULT 0;

comment on column hms_package_configs.registration_fee is
  'Hostel-wide default one-time registration fee. 0 = not configured — the Tenants page hides the per-tenant override field entirely until this is set.';
comment on column hms_package_configs.ac_maintenance_rate is
  'Hostel-wide flat monthly AC maintenance charge, applied automatically to every tenant whose room has_ac = true, regardless of package tier. 0 = not configured.';
comment on column hms_tenants.registration_fee is
  'One-time, non-refundable fee for this tenant (varies tenant to tenant). Billed once, in the check-in month only, via registration_fee_charge on hms_payments.';
comment on column hms_payments.registration_fee_charge is
  'This row''s one-time registration fee, populated only in the tenant''s check-in month (see computeRegistrationFeeCharge in lib/payment-calc.ts). Trusted by the recalculation trigger, not re-derived.';
comment on column hms_payments.ac_maintenance_charge is
  'This row''s recurring AC maintenance charge. Re-derived from scratch by hms_recalculate_payment_amount() on every insert/update from hms_tenants.room_id -> hms_rooms.has_ac and hms_package_configs.ac_maintenance_rate — whatever the app sends here is overwritten, same as food_charge.';

-- ---------------------------------------------------------------------------
-- Recalculation trigger: add the two new terms.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hms_recalculate_payment_amount()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_monthly_rent           numeric(10,2);
  v_billing_type           text;
  v_food_charge            numeric(10,2);
  v_ac_charge              numeric(10,2);
  v_deposit_charge         numeric(10,2);
  v_registration_fee_charge numeric(10,2);
  v_ac_maintenance_charge  numeric(10,2);
  v_base_rent              numeric(10,2);
  v_total                  numeric(10,2);
  v_hostel_id              uuid;
  v_room_id                uuid;
  v_room_has_ac            boolean := false;
  v_ac_maintenance_rate    numeric(10,2) := 0;
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
  new.registration_fee_charge := coalesce(new.registration_fee_charge, 0);
  new.ac_maintenance_charge   := coalesce(new.ac_maintenance_charge, 0);

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
  IF new.registration_fee_charge < 0 THEN
    RAISE EXCEPTION 'registration_fee_charge must be >= 0';
  END IF;
  IF new.ac_maintenance_charge < 0 THEN
    RAISE EXCEPTION 'ac_maintenance_charge must be >= 0';
  END IF;

  -- Validate payment_package_tier when supplied (all five tiers)
  IF new.payment_package_tier IS NOT NULL
     AND new.payment_package_tier NOT IN (
       'space_only', 'space_food', 'space_food_ac',
       'space_3meals', 'space_meals_cooler'
     ) THEN
    RAISE EXCEPTION 'invalid payment_package_tier: %', new.payment_package_tier;
  END IF;

  -- Look up canonical billing type, monthly_rent, room, and food add-on selection from hms_tenants
  SELECT monthly_rent, billing_type, hostel_id, room_id,
         coalesce(food_breakfast, false), coalesce(food_lunch, false), coalesce(food_dinner, false)
    INTO v_monthly_rent, v_billing_type, v_hostel_id, v_room_id,
         v_food_breakfast, v_food_lunch, v_food_dinner
    FROM hms_tenants
   WHERE id = new.tenant_id;

  -- Re-derive food charge and the AC maintenance rate from the canonical package config
  SELECT coalesce(food_monthly_rate, 0),
         coalesce(food_breakfast_rate, 0), coalesce(food_lunch_rate, 0),
         coalesce(food_dinner_rate, 0), coalesce(food_all_meals_rate, 0),
         coalesce(ac_maintenance_rate, 0)
    INTO v_food_rate, v_breakfast_rate, v_lunch_rate, v_dinner_rate, v_all_meals_rate,
         v_ac_maintenance_rate
    FROM hms_package_configs
   WHERE hostel_id = v_hostel_id;

  -- Re-derive whether this tenant's room has AC — AC maintenance is a pure
  -- function of current room + config state, re-derived fresh every time,
  -- exactly like food_charge below (not trusted from the app).
  IF v_room_id IS NOT NULL THEN
    SELECT has_ac INTO v_room_has_ac FROM hms_rooms WHERE id = v_room_id;
  END IF;

  new.ac_maintenance_charge := CASE WHEN v_room_has_ac THEN v_ac_maintenance_rate ELSE 0 END;

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

  v_food_charge             := new.food_charge;
  v_ac_charge               := new.ac_charge;
  v_deposit_charge          := new.security_deposit_charge;
  v_registration_fee_charge := new.registration_fee_charge;
  v_ac_maintenance_charge   := new.ac_maintenance_charge;

  IF v_billing_type = 'monthly' THEN
    -- RULE 2: an explicit per-row base-rent override (written only by
    -- checkout pro-rating) wins over the tenant's standing monthly_rent.
    -- NULL on every pre-existing row, so untouched rows are bit-for-bit
    -- identical to the previous behaviour.
    v_base_rent := coalesce(new.base_rent_override, v_monthly_rent, 0);
    v_total     := v_base_rent + v_food_charge + v_ac_charge + v_deposit_charge
                   + v_registration_fee_charge + v_ac_maintenance_charge;
    new.amount  := v_total;
  ELSE
    -- For daily tenants: pro-ration is computed in the app layer.
    -- Enforce that amount >= food_charge + ac_charge + security_deposit_charge
    -- + registration_fee_charge + ac_maintenance_charge.
    v_base_rent := new.amount - v_food_charge - v_ac_charge - v_deposit_charge
                   - v_registration_fee_charge - v_ac_maintenance_charge;
    IF v_base_rent < 0 THEN
      RAISE EXCEPTION
        'payment amount (%) is less than the sum of add-on charges food_charge (%) + ac_charge (%) + security_deposit_charge (%) + registration_fee_charge (%) + ac_maintenance_charge (%)',
        new.amount, v_food_charge, v_ac_charge, v_deposit_charge, v_registration_fee_charge, v_ac_maintenance_charge;
    END IF;
    new.amount := v_base_rent + v_food_charge + v_ac_charge + v_deposit_charge
                  + v_registration_fee_charge + v_ac_maintenance_charge;
  END IF;

  IF new.amount < 0 THEN
    RAISE EXCEPTION 'computed payment amount must be >= 0, got %', new.amount;
  END IF;

  RETURN new;
END;
$function$;

-- The BEFORE INSERT OR UPDATE trigger from 022_security_fixes.sql:170-173 is
-- unchanged and still points at this function; CREATE OR REPLACE swaps the
-- body underneath it. No re-attach needed, and no existing row is rewritten
-- until its next INSERT/UPDATE.
