-- A collected bill keeps its price even when the collection is reversed.
--
-- hms_recalculate_payment_amount froze the derived charges only when BOTH the
-- old and the new status were collected:
--
--     IF TG_OP = 'UPDATE'
--        AND old.status IN ('paid','partially_paid')
--        AND new.status IN ('paid','partially_paid') THEN
--
-- The comment in 186 called the paid -> pending case a "reversal" that should
-- "price normally". That was reasonable when nothing in the product could
-- reverse a payment. The Undo Payment feature does, and the consequence was
-- demonstrated on stage: a Rs 14,366 August bill, paid in full, became a
-- Rs 21,366 UNPAID bill the moment it was undone, because the tenant's rent had
-- risen from 12,000 to 19,000 in the meantime. That is exactly the falsification
-- 153_freeze_collected_bills.sql was written to prevent, reopened through an
-- edge nobody could reach until now.
--
-- Verified before writing this: no code path performs a paid -> pending UPDATE.
-- All four `status: "pending"` writers (payments.ts:1001, managers.ts:464,
-- tenant-checkout.ts:497, monthly-payment-sync.ts:127) build rows for INSERT,
-- and production holds zero bills with money collected against a pending,
-- overdue or waived status. So widening the guard changes the behaviour of
-- nothing that exists today; it only decides what happens when a payment is
-- undone.
--
-- Body below is the LIVE function dumped from production with pg_get_functiondef
-- and exactly one clause removed, so no drift from later migrations is lost.

CREATE OR REPLACE FUNCTION public.hms_recalculate_payment_amount()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
   -- referral phase 2 (1): the value the CALLER sent, captured before this
   -- function overwrites it. The freeze block below assigns new.referral_discount,
   -- so reading the column after that point would destroy the signal.
   v_caller_discount    numeric(10,2) := 0;
   v_gross_amount       numeric(10,2);
   v_referral_percent   smallint;
   v_referral_discount  numeric(10,2) := 0;
 BEGIN
   -- referral phase 2 (2): must be the first statement in the block.
   v_caller_discount := coalesce(new.referral_discount, 0);
   -- Normalise NULLs on the add-on columns
   new.food_charge             := coalesce(new.food_charge, 0);
   new.ac_charge               := coalesce(new.ac_charge, 0);
   new.late_fee                := coalesce(new.late_fee, 0);
   new.ac_units_consumed       := coalesce(new.ac_units_consumed, 0);
   new.security_deposit_charge := coalesce(new.security_deposit_charge, 0);
   new.registration_fee_charge := coalesce(new.registration_fee_charge, 0);
   new.ac_maintenance_charge   := coalesce(new.ac_maintenance_charge, 0);
   -- referral phase 2 (3). No non-negative RAISE beside the others: both columns
   -- carry their own CHECK and both are overwritten unconditionally below.
   new.referral_discount       := coalesce(new.referral_discount, 0);
   new.referral_percent        := coalesce(new.referral_percent, 0);

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
     -- referral phase 2 (4): a reservation holds a bed and bills only the
     -- one-time amounts. hms_referral_month_occupied() treats a reservation
     -- month as occupied precisely so no reward is ever placed here.
     new.referral_percent      := 0;
     new.referral_discount     := 0;
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
   -- Migration 208: the guard used to require new.status to ALSO be collected,
   -- which meant a paid -> pending reversal escaped the freeze and re-priced the
   -- bill at today's rent. Nothing could reverse a payment when this was
   -- written, so the case was theoretical; the Undo Payment feature makes it
   -- real. Once money has been collected against a bill, its price is history
   -- for every subsequent write, including one that un-collects it.
   IF TG_OP = 'UPDATE'
      AND old.status IN ('paid', 'partially_paid') THEN
     new.food_charge           := old.food_charge;
     new.ac_maintenance_charge := old.ac_maintenance_charge;
     -- referral phase 2 (5a): the PERCENT is pinned, not the rupees. A collected
     -- bill therefore keeps its discount even if the ledger row is later voided
     -- or cascaded away, AND a daily bill re-priced by checkout scales its
     -- discount with the new rent instead of handing back a full month's
     -- discount on a four-night stay. It is also what makes a frozen monthly
     -- bill recompute to EXACTLY old.amount: same rent, same percent, same rupees.
     new.referral_percent      := coalesce(old.referral_percent, 0);
     -- old.amount is stored NET. Add the discount back BEFORE the subtractions,
     -- or the recovered base rent is one discount too low and the discount is
     -- then taken a second time on every later write to a collected bill.
     -- coalesce is 0 for all 1,425 existing rows.
     v_billed_base_rent := old.amount
                           + coalesce(old.referral_discount, 0)
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
   ELSE
     -- referral phase 2 (5b): the discount is DERIVED, never trusted from the
     -- caller. Whatever arrived in new.referral_discount is discarded — exactly
     -- the posture ac_maintenance_charge already has. There is no request, no
     -- PATCH and no server action that can put a discount on a bill.
     --
     -- 'applied' is included deliberately: once a bill is collected, an unrelated
     -- later write (applyRoomACUnitsAction flipping paid -> partially_paid) must
     -- not resurrect the gross price.
     --
     -- Index-only probe on hms_referral_rewards_one_per_bill, which is EMPTY for
     -- every branch that has never enabled referrals.
     SELECT w.percent INTO v_referral_percent
       FROM hms_referral_rewards w
      WHERE w.tenant_id = new.tenant_id
        AND w.for_month = new.for_month
        AND w.status IN ('scheduled', 'applied')
      LIMIT 1;
     new.referral_percent := coalesce(v_referral_percent, 0);
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
   ELSE
     -- For daily tenants: pro-ration is computed in the app layer.
     --
     -- referral phase 2 (6): GROSS RESTORE. Unconditional, identity-based, no
     -- heuristic. gross = amount + whatever the caller says is already baked in.
     -- Every case collapses correctly:
     --   * gross writer  (referral_discount: 0)           -> gross = amount
     --   * bare update   ({status:'overdue'}, cron stamp)  -> gross = old net + old d
     --   * delta writer  (checkout AC merge)               -> gross = (net - a + b) + d
     --   * upsert pass 2 (EXCLUDED carries pass 1's output)-> gross = (G-D) + D = G
     -- For every row that has never carried a discount v_caller_discount is 0,
     -- so this is the identical expression to today's bare `new.amount`.
     v_gross_amount := new.amount + v_caller_discount;

     v_base_rent := v_gross_amount - v_food_charge - v_ac_charge - v_deposit_charge
                    - v_registration_fee_charge - v_ac_maintenance_charge;
     IF v_base_rent < 0 THEN
       RAISE EXCEPTION
         'payment amount (%) is less than the sum of add-on charges food_charge (%) + ac_charge (%) + security_deposit_charge (%) + registration_fee_charge (%) + ac_maintenance_charge (%)',
         v_gross_amount, v_food_charge, v_ac_charge, v_deposit_charge, v_registration_fee_charge, v_ac_maintenance_charge;
     END IF;
   END IF;

   -- referral phase 2 (6b): ONE discount formula, both branches, frozen or not.
   -- Clamped to RENT, not to the bill: the discount can never eat food, metered
   -- AC, the deposit, the registration fee or AC maintenance — which is what
   -- makes the negative-amount RAISE below unreachable by construction. Written
   -- BACK into the column, because splitPaymentCharges() reconstructs gross rent
   -- by adding it.
   v_referral_discount := LEAST(
       round(v_base_rent * coalesce(new.referral_percent, 0) / 100.0),
       GREATEST(v_base_rent, 0));
   new.referral_discount := v_referral_discount;

   v_total := v_base_rent + v_food_charge + v_ac_charge + v_deposit_charge
              + v_registration_fee_charge + v_ac_maintenance_charge
              - v_referral_discount;
   new.amount := v_total;

   IF new.amount < 0 THEN
     RAISE EXCEPTION 'computed payment amount must be >= 0, got %', new.amount;
   END IF;

   RETURN new;
 END;
 $function$

;
