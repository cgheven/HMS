-- Who collected the money.
--
-- DEPLOY ORDER MATTERS. app/actions/payments.ts, app/actions/managers.ts and
-- app/actions/partner.ts all write `recorded_by` INSIDE their existing
-- hms_payments UPDATE payload. PostgREST answers an unknown column with 42703,
-- which would fail the UPDATE itself — so deploying the code before this
-- migration does not merely break a notification, it makes every payment across
-- all 15 branches unrecordable. Apply this first and confirm
-- `select recorded_by from hms_payments limit 1` succeeds before deploying.
--
-- auth.users is the right FK target: it covers owners, partners and managers
-- alike (managers hold synthetic @hms-portal.internal accounts). on delete set
-- null, never cascade — removing a staff account must not delete the payments
-- they collected.
--
-- Both tables get the column. hms_payments.recorded_by is overwritten by
-- whoever collects the NEXT installment against the same bill, so
-- hms_payment_installments is the only durable per-transaction attribution.

alter table public.hms_payments
  add column if not exists recorded_by uuid
    references auth.users(id) on delete set null;

alter table public.hms_payment_installments
  add column if not exists recorded_by uuid
    references auth.users(id) on delete set null;

create index if not exists hms_payments_recorded_by_idx
  on public.hms_payments (recorded_by) where recorded_by is not null;

create index if not exists hms_payment_installments_recorded_by_idx
  on public.hms_payment_installments (recorded_by) where recorded_by is not null;
