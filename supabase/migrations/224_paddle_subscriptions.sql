-- Paddle self-payment for the owner's Pulse subscription.
--
-- Paddle is the SOURCE OF TRUTH for the subscription (it charges the card,
-- retries, handles tax as Merchant of Record). This table is a READ-MODEL kept
-- in sync by the Paddle webhook (app/api/paddle/webhook) — one row per owner.
-- Every write happens through the service-role client inside the webhook, so RLS
-- only needs to let an owner READ their own row for the /billing page.

create table if not exists public.hms_paddle_subscriptions (
  owner_id                uuid primary key references auth.users(id) on delete cascade,
  paddle_customer_id      text,
  paddle_subscription_id  text unique,
  -- active | trialing | past_due | paused | canceled
  status                  text not null default 'active',
  price_id                text,
  quantity                integer,
  unit_amount             numeric(12,2),
  currency_code           text,
  current_period_end      timestamptz,
  last_transaction_id     text,
  last_paid_at            timestamptz,
  created_at              timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

alter table public.hms_paddle_subscriptions enable row level security;

create policy "Owners view own paddle subscription"
  on public.hms_paddle_subscriptions for select
  using (auth.uid() = owner_id);

create trigger hms_paddle_subscriptions_updated_at
  before update on public.hms_paddle_subscriptions
  for each row execute function hms_set_updated_at();

-- Idempotency: Paddle may deliver the same event more than once. The webhook
-- records each event id here first and skips anything already present, so a
-- redelivery can never double-apply. Service-role only — no client access.
create table if not exists public.hms_paddle_webhook_events (
  event_id     text primary key,
  event_type   text,
  received_at  timestamptz not null default now()
);

alter table public.hms_paddle_webhook_events enable row level security;
