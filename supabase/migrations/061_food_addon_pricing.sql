-- Food add-on pricing: lets hostels offer meals as an independent, optional
-- charge (any Breakfast/Lunch/Dinner combo) on top of ANY room package,
-- instead of only the bundled 4-tier package system. Purely additive —
-- hostels that never set these rates see no change in behavior.
-- All columns default to 0/false, so existing rows and existing billing
-- logic (food_monthly_rate + FOOD_TIERS) are completely unaffected.

ALTER TABLE hms_package_configs
  ADD COLUMN IF NOT EXISTS food_breakfast_rate NUMERIC(10, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS food_lunch_rate NUMERIC(10, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS food_dinner_rate NUMERIC(10, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS food_all_meals_rate NUMERIC(10, 2) NOT NULL DEFAULT 0;

ALTER TABLE hms_tenants
  ADD COLUMN IF NOT EXISTS food_breakfast BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS food_lunch BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS food_dinner BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE hms_tenant_applications
  ADD COLUMN IF NOT EXISTS food_breakfast BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS food_lunch BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS food_dinner BOOLEAN NOT NULL DEFAULT false;
