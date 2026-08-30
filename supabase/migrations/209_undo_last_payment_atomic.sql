-- Undo a payment atomically.
--
-- performPaymentUndo did this as two PostgREST round trips with no transaction:
-- UPDATE hms_payments, then DELETE the installment. A failure between them was
-- logged and the operator was still told "Payment undone", leaving the bill
-- reading Rs 0 collected while the installment ledger still held the money.
-- Demonstrated on stage: Reports -> Today showed Rs 67,166 against the owner's
-- daily summary of Rs 52,800, the difference being exactly the orphaned
-- installment. Unrepairable through the UI, because a fully-undone bill renders
-- as unpaid and the Undo action is not offered on it.
--
-- Everything now happens in one statement: the guards, the restore and the
-- delete either all apply or none do. SELECT ... FOR UPDATE also replaces the
-- application-level optimistic check, closing the read-then-write race the two
-- payment-recording paths guard against with .eq("referral_percent", ...).
--
-- Returns one row describing what was reversed, or raises with a message the
-- caller shows verbatim.

create or replace function public.hms_undo_last_payment(
  p_payment_id uuid,
  p_hostel_id  uuid
)
returns table (
  amount            numeric,
  for_month         text,
  tenant_name       text,
  payment_date      date,
  installment_id    uuid,
  payment_method    text,
  receipt_number    text,
  restored_paid     numeric
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_payment      public.hms_payments%rowtype;
  v_latest       public.hms_payment_installments%rowtype;
  v_prev         public.hms_payment_installments%rowtype;
  v_accounted    numeric;
  v_restored     numeric;
  v_tenant_name  text;
begin
  -- Lock the bill for the duration: two concurrent undos, or an undo racing a
  -- collection, serialise here instead of interleaving.
  select * into v_payment
    from public.hms_payments
   where id = p_payment_id and hostel_id = p_hostel_id
   for update;

  if not found then
    raise exception 'Payment not found in this branch.';
  end if;

  if coalesce(v_payment.is_reservation, false) then
    raise exception 'This is a booking deposit, not a monthly payment. Undoing it would leave the tenant''s deposit record inconsistent — contact support to correct it.';
  end if;

  if v_payment.status = 'waived' then
    raise exception 'This bill was written off. Only the owner can change a waived bill.';
  end if;

  -- Only a COLLECTED bill can be un-collected. Besides being obviously correct,
  -- this keeps the transition inside the pricing freeze: migration 186 freezes
  -- the derived charges when the OLD status is paid or partially_paid, so an
  -- undo starting from pending would drop out of the freeze and re-price the
  -- bill at today's rates — the exact failure this whole design avoids.
  if v_payment.status not in ('paid', 'partially_paid') then
    raise exception 'There is no recorded payment on this bill to undo.';
  end if;

  select * into v_latest
    from public.hms_payment_installments
   where payment_id = p_payment_id and hostel_id = p_hostel_id
   order by created_at desc
   limit 1;

  if not found then
    raise exception 'There is no recorded payment on this bill to undo.';
  end if;

  -- amount_before is only a valid restore point if every writer of amount_paid
  -- also wrote an installment. lib/tenant-checkout.ts does not, so a checkout
  -- settlement would otherwise be erased.
  v_accounted := coalesce(v_latest.amount_before, 0) + coalesce(v_latest.amount, 0);
  if coalesce(v_payment.amount_paid, 0) > v_accounted + 0.01 then
    raise exception 'This bill has money recorded outside its payment history (a checkout settlement, most likely), so an undo cannot reverse it safely. Contact support to correct it.';
  end if;

  select * into v_prev
    from public.hms_payment_installments
   where payment_id = p_payment_id and hostel_id = p_hostel_id and id <> v_latest.id
   order by created_at desc
   limit 1;

  v_restored := coalesce(v_latest.amount_before, 0);

  -- ALWAYS partially_paid, never pending — even at zero. A pending row is
  -- re-priced at today's rates by the pricing trigger and by
  -- ensureMonthlyPaymentRows, which rewrites a historical bill. The collected
  -- status is what freezes the price; lib/payment-calc.ts hasCollected() is how
  -- the UI knows nothing is actually held.
  update public.hms_payments
     set amount_paid    = v_restored,
         status         = 'partially_paid',
         payment_date   = v_prev.payment_date,
         payment_method = v_prev.payment_method,
         receipt_number = v_prev.receipt_number,
         recorded_by    = v_prev.recorded_by
   where id = p_payment_id and hostel_id = p_hostel_id;

  delete from public.hms_payment_installments where id = v_latest.id;

  select t.full_name into v_tenant_name
    from public.hms_tenants t where t.id = v_payment.tenant_id;

  return query select
    coalesce(v_latest.amount, 0),
    coalesce(v_latest.for_month, v_payment.for_month),
    v_tenant_name,
    v_latest.payment_date,
    v_latest.id,
    v_latest.payment_method,
    v_latest.receipt_number,
    v_restored;
end;
$$;

-- Service role only: every caller is a server action using the admin client
-- after its own auth guard. No anon or authenticated grant.
revoke all on function public.hms_undo_last_payment(uuid, uuid) from public;
revoke all on function public.hms_undo_last_payment(uuid, uuid) from anon;
revoke all on function public.hms_undo_last_payment(uuid, uuid) from authenticated;
grant execute on function public.hms_undo_last_payment(uuid, uuid) to service_role;
