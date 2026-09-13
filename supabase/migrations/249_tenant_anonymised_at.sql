-- GDPR erasure marker. anonymiseTenantResidentAction pseudonymises a resident's
-- PII in place (keeping the row + every FK, so financial history and referential
-- integrity survive) and stamps this column, so the record can be shown as
-- "anonymised" and the action can refuse to run twice.
--
-- Purely additive and a verified no-op for every existing row: nullable, no
-- default, so every current PK (and every other) tenant/application reads back
-- byte-identical (anonymised_at IS NULL). The partial index only covers the rare
-- anonymised rows. The PII columns the action clears (phone, email, cnic,
-- father_name, the emergency-contact and address fields, date_of_birth, id_type,
-- vehicle_*, photo_url, documents, etc.) are ALL already nullable; only full_name
-- is NOT NULL, and the action writes a sentinel string there rather than NULL, so
-- no column needs its constraint relaxed.

ALTER TABLE public.hms_tenants
  ADD COLUMN IF NOT EXISTS anonymised_at timestamptz;

ALTER TABLE public.hms_tenant_applications
  ADD COLUMN IF NOT EXISTS anonymised_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_hms_tenants_anonymised_at
  ON public.hms_tenants (anonymised_at)
  WHERE anonymised_at IS NOT NULL;

COMMENT ON COLUMN public.hms_tenants.anonymised_at IS
  'GDPR: when the resident''s PII was pseudonymised in place (row + financial FKs retained). NULL = not anonymised.';
