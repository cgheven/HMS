-- Optional external transaction reference (bank/JazzCash TID) recorded against a
-- payment. Client-facing ledgers show it in a "TID" column. Nullable text, no
-- default — a pure additive column, safe to apply live (no rewrite, no lock of
-- consequence for a nullable column with no default on Postgres).
alter table public.hms_payments
  add column if not exists transaction_id text;

comment on column public.hms_payments.transaction_id is
  'Optional external transaction reference (bank/JazzCash TID) entered when recording a payment. Shown in the member Payment Ledger.';
