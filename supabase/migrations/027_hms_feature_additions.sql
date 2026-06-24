-- Migration 027: Feature additions
-- 1. emergency_relationship on tenants
-- 2. has_ac / has_cooler on rooms
-- 3. New package tiers: space_3meals, space_meals_cooler
-- 4. Auto-slug trigger for new hostels

-- 1. Emergency relationship
ALTER TABLE hms_tenants
  ADD COLUMN IF NOT EXISTS emergency_relationship text;

-- 2. Room amenities flags
ALTER TABLE hms_rooms
  ADD COLUMN IF NOT EXISTS has_ac boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_cooler boolean NOT NULL DEFAULT false;

-- 3. Expand package_tier CHECK constraint by dropping old and adding new
ALTER TABLE hms_tenants
  DROP CONSTRAINT IF EXISTS hms_tenants_package_tier_check;

ALTER TABLE hms_tenants
  ADD CONSTRAINT hms_tenants_package_tier_check
    CHECK (package_tier IN (
      'space_only',
      'space_food',
      'space_3meals',
      'space_food_ac',
      'space_meals_cooler'
    ));

-- 4. Also expand payment_package_tier if it has a check constraint
ALTER TABLE hms_payments
  DROP CONSTRAINT IF EXISTS hms_payments_payment_package_tier_check;

-- 5. Slug: backfill any hostel without a slug
UPDATE hms_hostels
SET slug = lower(regexp_replace(
  regexp_replace(name, '[^a-zA-Z0-9\s]+', '', 'g'),
  '\s+', '-', 'g'
))
WHERE slug IS NULL;

-- 6. Trigger: auto-set slug on new hostel INSERT
CREATE OR REPLACE FUNCTION hms_set_hostel_slug()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  base_slug text;
  candidate text;
  counter   int := 0;
BEGIN
  IF NEW.slug IS NOT NULL AND NEW.slug <> '' THEN
    RETURN NEW;
  END IF;
  base_slug := lower(regexp_replace(
    regexp_replace(NEW.name, '[^a-zA-Z0-9\s]+', '', 'g'),
    '\s+', '-', 'g'
  ));
  candidate := base_slug;
  LOOP
    EXIT WHEN NOT EXISTS (SELECT 1 FROM hms_hostels WHERE slug = candidate AND id <> NEW.id);
    counter := counter + 1;
    candidate := base_slug || '-' || counter;
  END LOOP;
  NEW.slug := candidate;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS hms_hostel_auto_slug ON hms_hostels;
CREATE TRIGGER hms_hostel_auto_slug
  BEFORE INSERT ON hms_hostels
  FOR EACH ROW EXECUTE FUNCTION hms_set_hostel_slug();
