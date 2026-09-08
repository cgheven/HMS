-- Province + district on public applications, mirroring hms_tenants (migration 216).
--
-- The /join admission form now collects both — the HotelEye/Smart Eye portal
-- cannot file a guest without them. Storing them on the application means an
-- approved applicant carries their own province/district straight into the
-- tenant record (convertToTenant reads app.permanent_province/district), rather
-- than the approver re-entering what the guest already typed.

alter table public.hms_tenant_applications
  add column if not exists permanent_province text,
  add column if not exists permanent_district text;
