-- Ms National Boys hostel: correct package tier for the 66 tenants imported in
-- migration 130. They were defaulted to 'space_only' (the register never
-- recorded a package), but this hostel serves 3 meals to every tenant
-- ("Meals Included" amenity, rent already inclusive) — 'space_only' was
-- mislabeled and confusing on the tenant list. This hostel's food_monthly_rate
-- is 0, so the tier switch does not change any tenant's billed amount, it
-- only corrects the displayed package.

DO $$
DECLARE
  h uuid := '514a77a0-167d-48e7-a47d-6b526a766937'; -- Ms National Boys hostel
  updated_count int;
BEGIN
  UPDATE hms_tenants
  SET package_tier = 'space_3meals'
  WHERE hostel_id = h AND package_tier = 'space_only';

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  IF updated_count <> 66 THEN
    RAISE EXCEPTION 'Expected to update 66 tenants, updated %', updated_count;
  END IF;
END $$;
