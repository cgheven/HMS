-- Add explicit per-package food rates so each hostel can set
-- Breakfast & Dinner and Breakfast + Lunch + Dinner prices independently.
-- Migrates existing food_monthly_rate: bd = rate*2, 3meals = rate*3.

ALTER TABLE hms_package_configs
  ADD COLUMN IF NOT EXISTS food_bd_rate     numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS food_3meals_rate numeric NOT NULL DEFAULT 0;

-- Seed from existing per-meal rate where available
UPDATE hms_package_configs
SET
  food_bd_rate     = food_monthly_rate * 2,
  food_3meals_rate = food_monthly_rate * 3
WHERE food_monthly_rate > 0
  AND food_bd_rate = 0;
