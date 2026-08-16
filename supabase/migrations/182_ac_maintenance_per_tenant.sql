-- Make AC maintenance optional and per-tenant.
--
-- Today the charge is decided by the DATABASE, not the app:
--   new.ac_maintenance_charge := CASE WHEN v_room_has_ac THEN v_ac_maintenance_rate ELSE 0 END;
-- Room has AC, therefore charge the branch-wide rate, and whatever the app sent
-- is overwritten. That is why an owner can neither waive it for one tenant nor
-- agree a different amount with them.
--
-- hms_tenants.ac_maintenance adds exactly one state that did not exist before:
--   NULL   -> no override, use the branch rate  (every existing row, so no bill moves)
--   number -> this tenant's own monthly rate
--   0      -> this tenant is opted out
--
-- The room gate is deliberately UNCHANGED. A tenant in a non-AC room is still
-- never charged maintenance, whatever the override says — the override sets the
-- amount, it does not extend the charge to rooms that never had it.
--
-- The function body below is the LIVE one, read out of pg_proc with
-- pg_get_functiondef and modified in exactly three places (one declaration, one
-- SELECT list, one CASE). It was not retyped from a migration file, because the
-- deployed body is migration 153's, not 099's, and rebuilding it by hand is how
-- a payment trigger silently loses a fix.
--
-- This function is SECURITY DEFINER and fires on EVERY write to hms_payments for
-- every client, so it is the highest-risk object in the product. Verified before
-- applying: a checksum over all payment rows, taken before and after forcing
-- every row back through the trigger, must be identical.
--
-- Note for later, deliberately NOT changed here: this function has no pinned
-- search_path (pg_proc.proconfig is null) despite being SECURITY DEFINER. That
-- is a real weakness and it belongs in its own migration, not bundled into a
-- change to money arithmetic.

alter table public.hms_tenants
  add column if not exists ac_maintenance numeric(10,2);

alter table public.hms_tenants
  drop constraint if exists hms_tenants_ac_maintenance_nonneg;

alter table public.hms_tenants
  add constraint hms_tenants_ac_maintenance_nonneg
  check (ac_maintenance is null or ac_maintenance >= 0);

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
   -- NULL = this tenant has no override, so the branch rate applies (the only
   -- state any existing row is in). A number = that tenant's own rate, and 0 is
   -- how a tenant opts out entirely.
   v_tenant_ac_maint        numeric(10,2);
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
   v_billed_base_rent numeric(10,2) := NULL;
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

   -- A reservation holds a bed; it does not buy a stay. Zero every occupancy
   -- charge and bill the one-time amounts only. Returning here is what makes
   -- this safe: the re-derivation below would otherwise reinstate food_charge
   -- and ac_maintenance_charge from the tenant's package tier, meal flags and
   -- room.has_ac, and the monthly branch would then add a full month's rent.
   IF new.is_reservation THEN
     new.food_charge           := 0;
     new.ac_maintenance_charge := 0;
     new.ac_charge             := 0;
     new.amount := new.security_deposit_charge + new.registration_fee_charge;

     IF new.amount < 0 THEN
       RAISE EXCEPTION 'computed payment amount must be >= 0, got %', new.amount;
     END IF;

     RETURN new;
   END IF;

   -- Look up canonical billing type, monthly_rent, room, and food add-on selection from hms_tenants
   SELECT monthly_rent, billing_type, hostel_id, room_id,
          coalesce(food_breakfast, false), coalesce(food_lunch, false), coalesce(food_dinner, false),
          ac_maintenance
     INTO v_monthly_rent, v_billing_type, v_hostel_id, v_room_id,
          v_food_breakfast, v_food_lunch, v_food_dinner,
          v_tenant_ac_maint
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

   -- Per-tenant override, falling back to the branch rate. The room gate is
   -- unchanged: a tenant in a non-AC room is never charged maintenance, whatever
   -- the override says. NULL means "no override", which is every existing row,
   -- so this evaluates exactly as before for all of them.
   new.ac_maintenance_charge := CASE
       WHEN NOT v_room_has_ac        THEN 0
       WHEN v_tenant_ac_maint IS NOT NULL THEN v_tenant_ac_maint
       ELSE v_ac_maintenance_rate
     END;

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

   -- A COLLECTED BILL IS HISTORY, NOT A LIVE CALCULATION.
   -- Everything above re-derives food_charge and ac_maintenance_charge from
   -- the hostel's CURRENT package config, and the monthly branch below takes
   -- the tenant's CURRENT monthly_rent. On a bill that has already been
   -- collected that is silent falsification: raise a rent in August and the
   -- next write of ANY kind to that tenant's paid January row rewrites it at
   -- the new rent. Pin the three derived components to what was actually
   -- billed instead.
   --
   -- Deliberately NOT a blanket freeze of new.amount. applyRoomACUnitsAction
   -- adds metered ac_charge to an already-paid bill on purpose (and flips it
   -- to partially_paid). ac_charge is caller-supplied, so it still flows
   -- through and the totals below still re-total correctly.
   --
   -- Guarded on BOTH old and new status, so the pending -> paid transition
   -- (the moment of collection) and a paid -> pending reversal both still
   -- price normally.
   IF TG_OP = 'UPDATE'
      AND old.status IN ('paid', 'partially_paid')
      AND new.status IN ('paid', 'partially_paid') THEN
     new.food_charge           := old.food_charge;
     new.ac_maintenance_charge := old.ac_maintenance_charge;
     v_billed_base_rent := old.amount
                           - coalesce(old.food_charge, 0)
                           - coalesce(old.ac_charge, 0)
                           - coalesce(old.security_deposit_charge, 0)
                           - coalesce(old.registration_fee_charge, 0)
                           - coalesce(old.ac_maintenance_charge, 0);
     -- A legacy row whose components already exceed its amount is internally
     -- inconsistent; fall back to normal pricing rather than pin a negative.
     IF v_billed_base_rent < 0 THEN
       v_billed_base_rent := NULL;
     END IF;
   END IF;

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
     v_base_rent := coalesce(v_billed_base_rent, new.base_rent_override, v_monthly_rent, 0);
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
