-- Snapshot branch count + standard (list) price onto each invoice at the moment
-- it's generated, rather than recomputing live from the client's CURRENT branch
-- count every time the PDF is viewed — an invoice is a historical record and
-- must not silently change if the client adds/removes a branch afterward.
-- No existing rows to backfill (table is empty at time of writing).
alter table hms_platform_invoices
  add column if not exists branch_count integer not null default 1,
  add column if not exists standard_annual_price numeric(12, 2) not null default 60000;

alter table hms_platform_invoices alter column branch_count drop default;
alter table hms_platform_invoices alter column standard_annual_price drop default;
