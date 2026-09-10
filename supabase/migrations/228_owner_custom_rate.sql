-- Per-owner negotiated/legacy price (per branch, in USD). When set, checkout and
-- the /billing preview use THIS rate instead of the standard catalog plan price —
-- honoring early-adopter deals (e.g. Rs 5,000 ≈ $18) without a per-owner Paddle
-- price. NULL = standard catalog pricing.
--
-- Decoupled from `plan` (migration 227): plan decides FEATURES, this decides
-- PRICE. e.g. a Standard-plan client can sit on the legacy rate.

SET lock_timeout = '3s';

ALTER TABLE public.hms_profiles
  ADD COLUMN IF NOT EXISTS custom_unit_amount_usd numeric(12,2);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hms_profiles_custom_rate_positive') THEN
    ALTER TABLE public.hms_profiles
      ADD CONSTRAINT hms_profiles_custom_rate_positive CHECK (custom_unit_amount_usd IS NULL OR custom_unit_amount_usd > 0);
  END IF;
END$$;

COMMENT ON COLUMN public.hms_profiles.custom_unit_amount_usd IS
  'Super Admin / service-role only. Negotiated per-branch price in USD (monthly). NULL = standard catalog plan pricing. Set for grandfathered/legacy clients only.';

-- Same self-grant guard as plan/subdomain: a table-wide GRANT makes a column
-- REVOKE moot, so only a trigger stops an owner from setting their own discount
-- from the browser. Service-role (auth.uid() NULL) passes.
CREATE OR REPLACE FUNCTION public.hms_guard_custom_unit_amount()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.custom_unit_amount_usd IS DISTINCT FROM OLD.custom_unit_amount_usd
     AND auth.uid() IS NOT NULL
     AND COALESCE((SELECT role FROM public.hms_profiles WHERE id = auth.uid()), '') <> 'super_admin'
  THEN
    RAISE EXCEPTION 'custom_unit_amount_usd can only be changed by a super admin';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS hms_profiles_guard_custom_unit_amount ON public.hms_profiles;
CREATE TRIGGER hms_profiles_guard_custom_unit_amount
  BEFORE UPDATE ON public.hms_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.hms_guard_custom_unit_amount();
