-- Migration 259: undo of a referred tenant's payment reverses the referral reward.
--
-- Bug: hms_undo_last_payment reversed the payment but never touched hms_referral_rewards,
-- and the settle trigger (hms_referral_on_payment_settled) is a one-way ratchet — so a
-- referred tenant's reward stayed 'applied' on the Marketing page after the payment was
-- undone, and the referrer's released reward stayed 'scheduled'. This adds the symmetric
-- unsettle: on a FULL undo (v_restored = 0), the referred reward goes applied->scheduled
-- and the referrer's released reward goes scheduled->held. Rebuilt from the live 256 def
-- with one added block after the installment delete; nothing else changes.

CREATE OR REPLACE FUNCTION public.hms_undo_last_payment(p_payment_id uuid, p_hostel_id uuid)
 RETURNS TABLE(amount numeric, for_month text, tenant_name text, payment_date date, installment_id uuid, payment_method text, receipt_number text, restored_paid numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
         -- Migration 256: a FULL reversal (nothing left collected) reverses the
         -- one-off discount that was entered with the payment — the bill reopens at
         -- its full price, re-collectable with a fresh discount. A partial undo
         -- (money still held) keeps it, since the recalc trigger still freezes it.
         manual_discount_amount = CASE WHEN v_restored = 0 THEN NULL ELSE manual_discount_amount END,
         payment_date   = v_prev.payment_date,
         payment_method = v_prev.payment_method,
         receipt_number = v_prev.receipt_number,
         recorded_by    = v_prev.recorded_by
   where id = p_payment_id and hostel_id = p_hostel_id;

  delete from public.hms_payment_installments where id = v_latest.id;

  -- Migration 259: reverse the referral reward settlement on a FULL undo, so the
  -- Marketing status stays honest and nobody keeps a discount for a payment that was
  -- reversed. Only on a full reversal (nothing left collected); a partial undo leaves
  -- the bill partially_paid, which genuinely still settles the reward. Wrapped so a
  -- reward-reversal hiccup can never fail the payment undo itself.
  if v_restored = 0 then
    begin
      -- Job A reverse: the referred tenant's OWN first-month reward goes back to
      -- 'scheduled' (a later re-collect re-applies it cleanly via the settle trigger).
      update public.hms_referral_rewards
         set status = 'scheduled', applied_amount = null,
             applied_payment_id = null, applied_at = null
       where applied_payment_id = p_payment_id and status = 'applied';
      -- Job B reverse: the REFERRER's reward that this friend's payment released
      -- (held -> scheduled) is put back on hold, so it cannot pay out on a reversed
      -- referral. Only still-scheduled rows — an already-applied referrer reward is a
      -- separate, collected bill and is left untouched. for_month cleared to satisfy
      -- the held-unplaced constraint.
      update public.hms_referral_rewards
         set status = 'held', for_month = null, qualified_at = null
       where matched_tenant_id = v_payment.tenant_id and status = 'scheduled'
         and role = 'referrer';
    exception when others then
      raise warning '[referral] reward reversal failed on undo of payment %: %', p_payment_id, sqlerrm;
    end;
  end if;

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
$function$;


-- Job A (settle trigger) idempotency: re-apply a reward that a payment UNDO reset
-- to 'scheduled' when the bill is re-collected. Safe because the UPDATE only touches
-- status='scheduled' rows (see the inline note). The referrer side is already handled
-- by Job B (fires on partially_paid -> paid) and the reconciler's held self-heal.
CREATE OR REPLACE FUNCTION public.hms_referral_on_payment_settled()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ref record; v_month text; v_prev_settled boolean;
BEGIN
  v_prev_settled := (TG_OP = 'UPDATE'
                     AND old.status IN ('paid','partially_paid','waived'));

  -- Job A: a settled bill retires the reward sitting on it. One place instead of
  -- six call sites (mark-paid, partial, waive, checkout settle, checkout waive,
  -- AC top-up).
  --
  -- NOT is_reservation is load-bearing. A reservation row is always born 'paid'
  -- and the trigger forces its referral_discount to 0, so without this guard a
  -- deposit collected in the same month as a queued reward would retire that
  -- reward with applied_amount = 0 — the tenant's welcome discount spent on a
  -- refundable deposit that never carried it.
  -- Migration 259: NOT v_prev_settled removed. Job A's UPDATE is scoped to
  -- status='scheduled', so re-running on a later settle transition is a no-op once
  -- applied — but it now RE-APPLIES a reward that a payment UNDO reset to 'scheduled'
  -- when the bill is re-collected (partially_paid -> paid), which the old guard
  -- suppressed. No double-apply: an already-'applied' reward never matches.
  IF new.status IN ('paid','partially_paid','waived')
     AND NOT new.is_reservation THEN
    BEGIN
      UPDATE hms_referral_rewards
         SET status='applied', applied_amount=new.referral_discount,
             applied_payment_id=new.id, applied_at=now(),
             void_reason = CASE WHEN new.status='waived' THEN 'bill_waived' ELSE void_reason END
       WHERE tenant_id = new.tenant_id AND for_month = new.for_month AND status='scheduled';
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[referral] job A failed for payment %: %', new.id, SQLERRM;
    END;
  END IF;

  -- Job B: money arrived, so the referrer's payout is released.
  -- 'paid' only. A waived first bill means no money arrived; the held row is
  -- expired with a reason the owner can see rather than paid out silently.
  --
  -- IT DOES NOT TOUCH THE REFERRER'S BILL. Doing so locks a second tenant's
  -- payment row inside a collection transaction and deadlocks ABBA against a
  -- concurrent collection of that referrer's own bill. The reconciler's step 3
  -- prices it, and payments-client.tsx calls syncMonth() immediately after every
  -- successful mark-paid, so it lands in the same click.
  IF new.status = 'paid' AND (TG_OP='INSERT' OR old.status <> 'paid') AND NOT new.is_reservation THEN
    BEGIN
      FOR v_ref IN SELECT id, tenant_id, earliest_month, expires_on
                     FROM hms_referral_rewards
                    WHERE matched_tenant_id = new.tenant_id AND status='held'
      LOOP
        -- Serialises two referred tenants qualifying for one referrer at the same
        -- instant, which would otherwise both pick the same month and have one
        -- silently swallowed by the handler.
        PERFORM pg_advisory_xact_lock(hashtextextended(v_ref.tenant_id::text, 0));
        v_month := hms_referral_next_open_month(
                     v_ref.tenant_id,
                     greatest(v_ref.earliest_month,
                              to_char((now() at time zone 'Asia/Karachi')::date,'YYYY-MM')),
                     v_ref.expires_on, v_ref.id);
        IF v_month IS NOT NULL THEN
          UPDATE hms_referral_rewards
             SET status='scheduled', for_month=v_month, qualified_at=now()
           WHERE id = v_ref.id AND status='held';
        END IF;
      END LOOP;
    EXCEPTION
      WHEN unique_violation THEN NULL;   -- expected collision; reconciler retries
      WHEN OTHERS THEN
        RAISE WARNING '[referral] job B failed for payment %: %', new.id, SQLERRM;
    END;
  END IF;

  RETURN NULL;
END;
$function$;

