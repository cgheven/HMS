-- 079: Partial payment support.
-- Today, marking a payment "paid" always records the FULL amount due — there is
-- no way to represent a tenant handing over less than the full rent for a month.
-- Adds amount_paid (running total actually collected so far) and a new
-- 'partially_paid' status so partial collections are recorded accurately
-- instead of either falsely marking the full amount paid or recording nothing.

alter table hms_payments
  add column if not exists amount_paid numeric(10,2) default 0 not null;

alter table hms_payments
  add constraint hms_payments_amount_paid_non_negative check (amount_paid >= 0);

alter table hms_payments drop constraint if exists hms_payments_status_check;
alter table hms_payments add constraint hms_payments_status_check
  check (status = ANY (ARRAY['paid'::text, 'pending'::text, 'overdue'::text, 'waived'::text, 'partially_paid'::text]));

-- Backfill: existing 'paid' rows were, by definition, paid in full.
update hms_payments set amount_paid = amount where status = 'paid' and amount_paid = 0;
