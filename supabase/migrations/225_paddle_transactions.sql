-- Paddle payment receipts (invoice history for card-paying owners).
--
-- Paddle is Merchant of Record: it issues the tax invoice for every card
-- payment. This table is a READ-MODEL of those payments, kept in sync by the
-- Paddle webhook (transaction.completed / transaction.paid) so the /billing
-- "Invoice History" can list them and link to Paddle's hosted invoice PDF.
-- Every write is service-role inside the webhook; RLS only lets an owner READ
-- their own receipts.

create table if not exists public.hms_paddle_transactions (
  transaction_id          text primary key,
  owner_id                uuid not null references auth.users(id) on delete cascade,
  paddle_subscription_id  text,
  -- grand total actually charged, in major units (e.g. 145.00), tax-inclusive
  amount                  numeric(12,2),
  currency_code           text,
  status                  text,
  invoice_number          text,
  billed_at               timestamptz,
  created_at              timestamptz not null default now()
);

create index if not exists hms_paddle_transactions_owner_billed_idx
  on public.hms_paddle_transactions (owner_id, billed_at desc);

alter table public.hms_paddle_transactions enable row level security;

create policy "Owners view own paddle transactions"
  on public.hms_paddle_transactions for select
  using (auth.uid() = owner_id);
