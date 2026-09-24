-- Migration 270: add transaction_id to payment installments.
--
-- markPaymentPaidAction (app/actions/payments.ts) writes a per-installment
-- transaction_id — the bank/wallet TID for THAT specific collection — alongside
-- the one on hms_payments. The column was referenced in code (shipped in the
-- Payment Ledger + TID feature, commit f4f3f86) but NO migration ever created it,
-- so the installment INSERT silently failed ("Could not find the 'transaction_id'
-- column of 'hms_payment_installments' in the schema cache") — the error is
-- swallowed as non-fatal. Result: a bill gets marked paid with NO installment row,
-- which breaks Undo Last Payment (it reverses the most recent installment) and the
-- per-installment receipt/ledger TID.
--
-- Additive, nullable, no backfill: every existing installment keeps NULL, so this
-- cannot disturb any recorded payment.

alter table public.hms_payment_installments
  add column if not exists transaction_id text;

-- Refresh PostgREST's schema cache so the new column is writable immediately
-- (without waiting for the periodic reload).
notify pgrst, 'reload schema';
