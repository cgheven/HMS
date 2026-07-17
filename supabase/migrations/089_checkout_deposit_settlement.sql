-- Checkout deposit settlement
--
-- The checkout dialog has always *displayed* "Deposit (applied) − Rs X / Deposit
-- covers all dues", but nothing ever recorded it: the deduction was computed in the
-- client's summary box and thrown away. Dues were left pending on departed tenants
-- and deposits were silently refunded on top. These two columns give the deduction
-- somewhere real to live.

-- How much of a payment was settled out of the tenant's held deposit rather than
-- fresh cash. amount_paid stays the full settled figure (the due really is cleared);
-- this splits out the portion that was already collected at check-in, so revenue
-- reporting can avoid counting the same rupees twice.
alter table hms_payments
  add column if not exists deposit_applied numeric not null default 0;

comment on column hms_payments.deposit_applied is
  'Portion of amount_paid settled from the security deposit rather than new cash. Set at checkout.';

-- Deposit lifecycle in the Member Ledger was collected → returned | forfeited, with
-- no way to say "we kept part of it to cover what they owed". Without this the
-- applied portion has to masquerade as a forfeit, which reads as a penalty.
alter table hms_tenant_events
  drop constraint if exists hms_tenant_events_event_type_check;

alter table hms_tenant_events
  add constraint hms_tenant_events_event_type_check
  check (event_type = any (array[
    'room_changed',
    'plan_changed',
    'deposit_collected',
    'deposit_returned',
    'deposit_forfeited',
    'deposit_applied',
    'notice_given',
    'notice_cancelled'
  ]));
