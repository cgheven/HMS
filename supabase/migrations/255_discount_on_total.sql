-- Migration 255: widen the one-off (Pay-dialog) discount to the total.
--
-- The one-off operator discount used to be a PERCENT OF RENT, so it could never
-- reach the electricity charge or exceed the rent. It becomes a RUPEE amount off
-- the discountable subtotal (rent + electricity + food + AC maintenance); the
-- operator can still enter it as % or Rs (a % is converted to rupees against
-- that subtotal). The standing (per-tenant admission) discount and the referral
-- discount are UNCHANGED (percent of rent).
--
-- BYTE-IDENTICAL: manual_discount_amount is backfilled to the exact rupees each
-- existing one-off discount already produces, so no existing bill's amount moves;
-- the change only lifts the ceiling. Every bill without a one-off discount is
-- bit-for-bit identical (standing/referral math untouched).

-- Rupee source of truth for the one-off discount. NULL = no one-off recorded.
ALTER TABLE hms_payments
  ADD COLUMN IF NOT EXISTS manual_discount_amount numeric(10,2);

-- The backfill runs with triggers suppressed for THIS session: otherwise the
-- (old) recalc trigger fires on the UPDATE and immediately rewrites
-- discount_percent back to the old combined (standing + one-off) value, undoing
-- the narrowing below. Money columns (amount, discount_amount) are left
-- untouched, so nothing about any bill's total changes — byte-identical.
SET session_replication_role = replica;

-- Backfill for existing rows that carried a one-off discount:
--   * manual_discount_amount = the rupees the one-off already produced = the
--     combined discount_amount minus the standing portion (round(rent*standing%)).
--   * discount_percent is narrowed to STANDING-ONLY (it used to be standing+one-off
--     combined), so it means the same thing on every row, old and new, and the
--     collected-bill branch can pin it without double-counting the one-off.
-- Standing and one-off discounts do not coexist on any existing bill (verified),
-- so for the common case (standing = 0) manual_discount_amount is exactly
-- discount_amount and discount_percent becomes 0. Both RHS use the pre-update
-- (old) values. Verified byte-identical by a rolled-back recompute-diff.
UPDATE hms_payments p
SET manual_discount_amount = GREATEST(
      coalesce(p.discount_amount, 0)
      - round(
          -- reconstructed gross rent
          ( coalesce(p.amount,0) + coalesce(p.referral_discount,0) + coalesce(p.discount_amount,0)
            - coalesce(p.food_charge,0) - coalesce(p.ac_charge,0) - coalesce(p.security_deposit_charge,0)
            - coalesce(p.registration_fee_charge,0) - coalesce(p.ac_maintenance_charge,0) )
          -- standing percent = combined discount_percent minus the one-off percent
          * GREATEST(coalesce(p.discount_percent,0) - coalesce(p.manual_discount_percent,0), 0) / 100.0
        ),
      0),
    discount_percent = GREATEST(coalesce(p.discount_percent,0) - coalesce(p.manual_discount_percent,0), 0)
WHERE coalesce(p.manual_discount_percent, 0) > 0;

SET session_replication_role = DEFAULT;

ALTER TABLE hms_payments
  DROP CONSTRAINT IF EXISTS hms_payments_manual_discount_amount_nonneg;
ALTER TABLE hms_payments
  ADD CONSTRAINT hms_payments_manual_discount_amount_nonneg
  CHECK (manual_discount_amount IS NULL OR manual_discount_amount >= 0);

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
   -- Feature: manual discounts (migration 211). Two sources, one number.
   --   v_standing_pct — the tenant's admission discount, a standing concession
   --     that applies every month until it is removed.
   --   v_manual_pct   — the one-off percentage an operator typed in the Pay
   --     dialog for THIS bill only (a tenant away most of the month).
   -- They stack, and the sum is clamped so the two together can never exceed
   -- the rent.
   v_standing_pct       numeric(5,2) := 0;
   v_manual_pct         numeric(5,2) := 0;
   v_discount_pct       numeric(5,2) := 0;
   v_discount_amount    numeric(10,2) := 0;
   v_gross_amount       numeric(10,2);
   v_referral_percent   smallint;
   v_referral_discount  numeric(10,2) := 0;
   -- Migration 255: the one-off operator discount is now a RUPEE amount off the
   -- discountable subtotal (rent + electricity + food + AC maintenance). Standing
   -- (per-tenant) and referral discounts stay percent-of-rent, unchanged.
   v_discountable       numeric(10,2) := 0;
   v_manual_amount      numeric(10,2) := 0;
   v_standing_discount  numeric(10,2) := 0;
   v_manual_discount    numeric(10,2) := 0;
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
     -- A reservation bills only the deposit and registration fee, and a discount
     -- applies to RENT alone — there is no rent here to discount.
     new.discount_percent      := 0;
     new.discount_amount       := 0;
     new.manual_discount_percent := NULL;
     new.manual_discount_amount  := NULL;
     new.amount := new.security_deposit_charge + new.registration_fee_charge;

     IF new.amount < 0 THEN
       RAISE EXCEPTION 'computed payment amount must be >= 0, got %', new.amount;
     END IF;

     RETURN new;
   END IF;

   -- Look up canonical billing type, monthly_rent, room, and food add-on selection from hms_tenants
   SELECT monthly_rent, billing_type, hostel_id, room_id,
          coalesce(food_breakfast, false), coalesce(food_lunch, false), coalesce(food_dinner, false),
          ac_maintenance, coalesce(discount_percent, 0)
     INTO v_monthly_rent, v_billing_type, v_hostel_id, v_room_id,
          v_food_breakfast, v_food_lunch, v_food_dinner,
          v_tenant_ac_maint, v_standing_pct
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
     -- Same posture as referral_percent, for the same reason: pin the PERCENT,
     -- not the rupees. A collected bill keeps the discount it was collected
     -- with even if the tenant's standing discount is later changed or removed,
     -- and a daily bill re-priced at checkout scales its discount with the new
     -- rent instead of handing back a full month's worth for a four-night stay.
     new.discount_percent        := coalesce(old.discount_percent, 0);
     new.manual_discount_percent := old.manual_discount_percent;
     -- Pin the one-off discount RUPEES too, so a collected bill re-prices to
     -- exactly old.amount regardless of how the subtotal is later re-derived.
     new.manual_discount_amount  := old.manual_discount_amount;
     -- old.amount is stored NET. Add the discount back BEFORE the subtractions,
     -- or the recovered base rent is one discount too low and the discount is
     -- then taken a second time on every later write to a collected bill.
     -- coalesce is 0 for all 1,425 existing rows.
     v_billed_base_rent := old.amount
                           + coalesce(old.referral_discount, 0)
                           -- old.amount is stored NET of this too, so it comes
                           -- back before the subtractions for the same reason.
                           + coalesce(old.discount_amount, 0)
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

     -- The standing discount is DERIVED from the tenant, never trusted from the
     -- caller. The manual one is operator input by definition — it is the number
     -- they just typed in the Pay dialog — so it is taken from the row, bounded
     -- here rather than believed. Every write reaches this table through a
     -- server action holding createAdminClient(); RLS admits no direct write.
     -- The standing (recurring, per-tenant) discount is a percent of rent and is
     -- stored on the payment as-is. The one-off operator discount is no longer a
     -- percent here: it is a rupee amount (new.manual_discount_amount) applied to
     -- the discountable subtotal, computed in the discount block below.
     new.discount_percent := v_standing_pct;
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

   -- referral: percent of RENT, clamped to rent. Unchanged.
   v_referral_discount := LEAST(
       round(v_base_rent * coalesce(new.referral_percent, 0) / 100.0),
       GREATEST(v_base_rent, 0));
   new.referral_discount := v_referral_discount;

   -- standing (recurring, per-tenant admission) discount: percent of RENT,
   -- clamped to the rent the referral discount has not already taken. Unchanged.
   v_standing_discount := LEAST(
       round(v_base_rent * coalesce(new.discount_percent, 0) / 100.0),
       GREATEST(v_base_rent - v_referral_discount, 0));

   -- one-off operator discount (migration 255): a RUPEE amount off the
   -- DISCOUNTABLE SUBTOTAL = rent + electricity + food + AC maintenance. Never the
   -- deposit or the registration fee. This is what lets a discount reach the
   -- electricity charge and exceed the rent. Clamped to whatever the referral +
   -- standing discounts have left of that subtotal, so the total never goes
   -- negative and the RAISE below stays unreachable.
   v_discountable  := v_base_rent + v_food_charge + v_ac_charge + v_ac_maintenance_charge;
   v_manual_amount := GREATEST(coalesce(new.manual_discount_amount, 0), 0);

   -- DAILY BILLS CARRY NO DISCOUNT (same posture as before): the daily branch
   -- reconstructs gross without adding discount_amount back, so any discount left
   -- on a daily row is re-taken on every later write. Zero every discount here.
   IF v_billing_type IS DISTINCT FROM 'monthly' THEN
     v_standing_discount         := 0;
     v_manual_amount             := 0;
     new.discount_percent        := 0;
     new.manual_discount_percent := NULL;
     new.manual_discount_amount  := NULL;
   END IF;

   v_manual_discount := LEAST(
       v_manual_amount,
       GREATEST(v_discountable - v_referral_discount - v_standing_discount, 0));

   -- Persist the clamped one-off: the RUPEE amount (source of truth) and its
   -- effective PERCENT of the discountable subtotal (for reports/receipts).
   -- NULL input means "no one-off recorded" and stays NULL, exactly as the
   -- percent column behaved before.
   IF new.manual_discount_amount IS NULL THEN
     new.manual_discount_percent := NULL;
   ELSE
     new.manual_discount_amount := v_manual_discount;
     -- Fresh bills derive the display % from the discountable subtotal; a
     -- COLLECTED bill keeps the percent it was collected with (pinned above),
     -- so a re-printed historical receipt is unchanged.
     IF v_billed_base_rent IS NULL THEN
       new.manual_discount_percent := CASE WHEN v_discountable > 0 AND v_manual_discount > 0
                                           THEN round(v_manual_discount / v_discountable * 100.0, 2)
                                           ELSE 0 END;
     END IF;
   END IF;

   -- discount_amount stays the COMBINED total (standing + one-off) in rupees, so
   -- splitPaymentCharges() reconstructs gross rent by adding it back exactly as
   -- before — the algebra holds even when the one-off exceeds the rent.
   v_discount_amount := v_standing_discount + v_manual_discount;
   new.discount_amount := v_discount_amount;

   v_total := v_base_rent + v_food_charge + v_ac_charge + v_deposit_charge
              + v_registration_fee_charge + v_ac_maintenance_charge
              - v_referral_discount - v_discount_amount;
   new.amount := v_total;

   IF new.amount < 0 THEN
     RAISE EXCEPTION 'computed payment amount must be >= 0, got %', new.amount;
   END IF;

   RETURN new;
 END;
 $function$;
