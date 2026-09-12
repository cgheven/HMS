-- "Which account received this payment" — reconciliation aid.
--
-- When recording a payment, the owner can pick one of the hostel's configured
-- payment accounts (settings -> payment methods: {label, account_number}) so the
-- record shows where the money landed, instead of only cash/bank_transfer. Stored
-- as the human account label (e.g. "HBL - 1234"); NULL when not chosen (cash,
-- legacy rows, or collectors without a configured-accounts picker), so this is a
-- verified no-op for every existing payment.

ALTER TABLE public.hms_payments
  ADD COLUMN IF NOT EXISTS received_account text;

COMMENT ON COLUMN public.hms_payments.received_account IS
  'Optional label of the configured payment account this payment was received into (owner reconciliation). NULL = not specified.';
