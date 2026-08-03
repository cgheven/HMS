-- Reservation deposits: taking money in month M to hold a bed the tenant will
-- occupy from month M+1.
--
-- The money is real and must land in month M's collected figure with a receipt
-- dated in month M. But it is NOT a stay: no base rent, no food, no AC, no AC
-- maintenance. hms_recalculate_payment_amount() cannot express that today. For
-- a monthly tenant it unconditionally overwrites `amount` with
-- monthly_rent + food + ac + deposit + registration + ac_maintenance, and it
-- RE-DERIVES food_charge and ac_maintenance_charge from the tenant record
-- (package tier, food_breakfast/lunch/dinner, room.has_ac) while ignoring
-- whatever the app sent. So a deposit-only row inserted for July comes back out
-- of the trigger as a full July bill for a tenant who has not moved in.
--
-- The fix is a single guarded early-return branch keyed off a new boolean that
-- defaults false. Every pre-existing row and every normal write reaches the
-- identical code path it reaches today — verified by checksumming all of
-- hms_payments, applying this migration, forcing every row back through the
-- trigger with `UPDATE hms_payments SET updated_at = updated_at`, and
-- re-checksumming.

-- ---------------------------------------------------------------------------
-- 1. The flag on the payment row.
-- ---------------------------------------------------------------------------
ALTER TABLE hms_payments
  ADD COLUMN IF NOT EXISTS is_reservation boolean NOT NULL DEFAULT false;

comment on column hms_payments.is_reservation is
  'This row is a bed reservation, not a stay: money collected in for_month to hold a bed the tenant occupies later. hms_recalculate_payment_amount() bills it as security_deposit_charge + registration_fee_charge only — no base rent, no food, no AC, no AC maintenance, for monthly and daily billing types alike. Defaults false; every non-reservation row takes the unchanged code path.';

-- No index. The three access patterns that exist all hit an existing index:
-- "the reservation row for this tenant" is covered by the unique index on
-- (tenant_id, for_month) and by idx_hms_payments_tenant_month; "this month's
-- collected total for this branch" is covered by idx_hms_payments_hostel_month.
-- Reservations are a handful of rows in a 1,300-row table, so a partial index
-- on the flag would earn nothing and cost a write on every payment insert.

-- ---------------------------------------------------------------------------
-- 2. What was actually collected ahead of check-in, and when.
--
-- An AMOUNT, not a boolean. A tenant whose deposit is Rs 10,000 can put down
-- Rs 5,000 to hold the bed; a flag would have said "deposit done" and the other
-- Rs 5,000 would never have been billed, while checkout still refunded the full
-- Rs 10,000 out of hms_tenants.security_deposit.
--
-- The owner's rule: the deposit itself stays Rs 10,000, the shortfall is billed
-- on the first monthly bill alongside rent, and checkout refunds Rs 10,000.
-- So security_deposit remains the agreed deposit and this column records only
-- how much of it has already been handed over.
-- ---------------------------------------------------------------------------
ALTER TABLE hms_tenants
  ADD COLUMN IF NOT EXISTS deposit_collected_on date;

ALTER TABLE hms_tenants
  ADD COLUMN IF NOT EXISTS deposit_collected_amount numeric NOT NULL DEFAULT 0;

comment on column hms_tenants.deposit_collected_on is
  'Date the security deposit money was actually received, when it was received ahead of check-in via a reservation row. Printed on the reservation receipt and answers "when did we take it". NULL = nothing collected ahead of check-in. Billing decisions are driven by deposit_collected_amount, never by this date.';

comment on column hms_tenants.deposit_collected_amount is
  'How much of security_deposit has already been collected ahead of check-in (a reservation row carries the matching money). The check-in month bills the REMAINDER: computeDepositCharge in lib/payment-calc.ts returns max(0, security_deposit - deposit_collected_amount) in the check-in month and 0 in every other month. Never exceeds security_deposit (enforced in recordReservationDepositAction). security_deposit itself is unchanged by a collection, so checkout still refunds the full agreed deposit. 0 on every pre-existing tenant, which reproduces the previous behaviour exactly.';

-- ---------------------------------------------------------------------------
-- 3. The trigger. Current live body verbatim, plus ONE guarded branch.
--
-- The branch sits after the NULL normalisation, after every non-negative
-- validation, and after the payment_package_tier validation — so a reservation
-- row is held to exactly the same input invariants as any other row — and
-- before the three hms_tenants / hms_package_configs / hms_rooms lookups that
-- exist only to re-derive charges a reservation does not have. Early RETURN,
-- so neither the monthly branch nor the daily branch can touch `amount`.
--
-- Base rent is excluded for BOTH billing types. The daily else-branch derives
-- base rent by subtracting the add-ons from the app-supplied amount and raises
-- if the result is negative; for a reservation that would either bill a phantom
-- night or raise, depending on what the app happened to send. A reservation is
-- not a stay in either billing model.
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
-- body underneath it. No re-attach needed, and no existing row is rewritten.
--
-- RLS needs no change: both policies on hms_payments ("Owner manages own
-- payments", "members_read_payments") qualify on hostel_id only and name no
-- columns, and the anon/authenticated/service_role grants are table-level, so
-- they extend to is_reservation automatically.

-- ---------------------------------------------------------------------------
-- 4. Moving a joining date INTO a month that already holds a reservation row.
--
-- hms_payments is UNIQUE (tenant_id, for_month) and ensureMonthlyPaymentRows
-- skips rows that are already paid. A reservation row is paid by definition, so
-- once July holds one, July's rent bill for that tenant can never be created —
-- the tenant reads as fully settled for a month they actually owe rent for, and
-- nothing anywhere reports an error.
--
-- recordReservationDepositAction refuses to take a deposit for the joining
-- month, but that check runs once, at collection time. Editing the joining date
-- afterwards (early arrival, or a typo being corrected) walked straight past it.
--
-- The comparison is `>=`, not `=`. A reservation is only ever legitimate for a
-- month BEFORE the tenant joins; a reservation sitting in the joining month or
-- any month after it strands that month's rent just the same. Equality alone
-- blocked `2026-08-05 -> 2026-07-25` but waved through `-> 2026-06-20`, which
-- is precisely the typo this guard exists to catch.
--
-- Enforced here rather than in the four TypeScript write paths because one of
-- them — the owner's own tenant edit in tenants-client.tsx — is a direct
-- supabase-js UPDATE from the browser. A guard in the server actions would
-- leave the commonest path open, and a client-side check is not enforcement.
-- Every writer (owner, manager, partner, application approval, psql, the REST
-- API) goes through this one statement. The message is written for a hostel
-- owner, not an operator: it names the money, the month, and the exact date to
-- use instead.
--
-- Fires only when check_in actually MOVES, so unrelated edits to a tenant who
-- holds a reservation (phone number, room, package) are untouched. INSERT is
-- not covered because a tenant that does not exist yet cannot own a payment row.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hms_guard_check_in_vs_reservation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_amount      numeric;
  v_month_start date;
BEGIN
  IF new.check_in IS NULL OR old.check_in IS NOT DISTINCT FROM new.check_in THEN
    RETURN new;
  END IF;

  SELECT p.amount, (p.for_month || '-01')::date
    INTO v_amount, v_month_start
    FROM hms_payments p
   WHERE p.tenant_id = new.id
     AND p.is_reservation
     AND p.for_month >= to_char(new.check_in, 'YYYY-MM')
   ORDER BY p.for_month DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN new;
  END IF;

  RAISE EXCEPTION
    'A Rs % reservation deposit was collected for %. A joining date in that month or earlier would leave %''s rent unbilled. Set the joining date to % or later.',
    to_char(v_amount, 'FM999,999,990'),
    to_char(v_month_start, 'FMMonth YYYY'),
    to_char(v_month_start, 'FMMonth YYYY'),
    to_char(v_month_start + interval '1 month', 'FMDD FMMonth YYYY');
END;
$function$;

DROP TRIGGER IF EXISTS hms_tenants_guard_check_in_reservation ON hms_tenants;
CREATE TRIGGER hms_tenants_guard_check_in_reservation
  BEFORE UPDATE OF check_in ON hms_tenants
  FOR EACH ROW EXECUTE FUNCTION hms_guard_check_in_vs_reservation();

-- ---------------------------------------------------------------------------
-- Guard: the agreed deposit can never be edited below what has already been
-- taken.
--
-- Checkout refunds hms_tenants.security_deposit — the AGREED figure, not the
-- collected one. So dropping the agreed deposit from Rs 10,000 to Rs 4,000
-- after Rs 5,000 was already banked means the tenant is handed back Rs 4,000
-- for money they paid Rs 5,000 of, and the first bill charges Rs 0 rather than
-- reclaiming the difference. Nothing anywhere reports it; the tenant is simply
-- Rs 1,000 short at checkout, which is the exact dispute this whole feature was
-- built to prevent.
--
-- Same placement reasoning as the check_in guard above: the owner's own tenant
-- edit is a direct browser UPDATE, so the database is the only chokepoint every
-- writer passes through. Raising the deposit is always fine — the balance just
-- lands on the next bill.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hms_guard_deposit_vs_collected()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_collected numeric := coalesce(new.deposit_collected_amount, 0);
BEGIN
  IF v_collected <= 0 OR coalesce(new.security_deposit, 0) >= v_collected THEN
    RETURN new;
  END IF;

  RAISE EXCEPTION
    'Rs % has already been collected from this member as a reservation deposit. The agreed deposit cannot be set below that. Use Rs % or more, and refund the difference at checkout instead.',
    to_char(v_collected, 'FM999,999,990'),
    to_char(v_collected, 'FM999,999,990');
END;
$function$;

DROP TRIGGER IF EXISTS hms_tenants_guard_deposit_vs_collected ON hms_tenants;
CREATE TRIGGER hms_tenants_guard_deposit_vs_collected
  BEFORE UPDATE OF security_deposit, deposit_collected_amount ON hms_tenants
  FOR EACH ROW EXECUTE FUNCTION hms_guard_deposit_vs_collected();
