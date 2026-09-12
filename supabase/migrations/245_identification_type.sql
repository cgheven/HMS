-- Flexible identification for the international market (non-PK): the applicant
-- picks WHICH document they're providing (Passport / Driving Licence / National
-- Identity Card / Other) and enters its number. The number reuses the existing
-- `cnic` column (it is "the tenant's ID number" — PK stores a CNIC there,
-- international stores a passport/licence number); this column records the TYPE.
--
-- Pakistan is unchanged: it keeps the fixed CNIC field, so id_type stays NULL
-- for every PK application/tenant. Nullable, no default — a verified no-op for
-- existing rows.

ALTER TABLE public.hms_tenant_applications
  ADD COLUMN IF NOT EXISTS id_type text;

ALTER TABLE public.hms_tenants
  ADD COLUMN IF NOT EXISTS id_type text;

COMMENT ON COLUMN public.hms_tenants.id_type IS
  'International identification document type (passport | driving_licence | national_id | other). NULL for PK, which uses the fixed CNIC (stored in cnic).';
