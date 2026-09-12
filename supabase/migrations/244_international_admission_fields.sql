-- International admission form (non-PK): date of birth + a structured permanent
-- address (Address Line 1/2, City, County/State/Province, Postcode, Country).
--
-- Pakistan keeps its existing admission form (CNIC + Smart Eye province/district +
-- free-text permanent_address) unchanged; these columns are the international
-- market's structured address, used by non-guest-registration countries. All
-- nullable, no default — a verified no-op for every existing application/tenant.

ALTER TABLE public.hms_tenant_applications
  ADD COLUMN IF NOT EXISTS date_of_birth   date,
  ADD COLUMN IF NOT EXISTS address_line1   text,
  ADD COLUMN IF NOT EXISTS address_line2   text,
  ADD COLUMN IF NOT EXISTS city            text,
  ADD COLUMN IF NOT EXISTS county_state    text,
  ADD COLUMN IF NOT EXISTS postcode        text,
  ADD COLUMN IF NOT EXISTS address_country text;

ALTER TABLE public.hms_tenants
  ADD COLUMN IF NOT EXISTS date_of_birth   date,
  ADD COLUMN IF NOT EXISTS address_line1   text,
  ADD COLUMN IF NOT EXISTS address_line2   text,
  ADD COLUMN IF NOT EXISTS city            text,
  ADD COLUMN IF NOT EXISTS county_state    text,
  ADD COLUMN IF NOT EXISTS postcode        text,
  ADD COLUMN IF NOT EXISTS address_country text;

COMMENT ON COLUMN public.hms_tenants.county_state IS
  'International address: County / State / Province (free text). PK continues to use permanent_province/permanent_district for Smart Eye.';
