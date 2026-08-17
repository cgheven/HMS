-- Referral Phase 2, part 1: schema only. No function bodies that price anything,
-- no behaviour change. Every column added here lands on a value that makes every
-- expression in 185 collapse to the arithmetic that is live today:
--   hms_payments.referral_discount = 0  on all 1,425 rows
--   hms_payments.referral_percent  = 0  on all 1,425 rows
--   hms_referrals.promised_*       = 0  on all 3 rows (no backfill, deliberately)
--   hms_referral_rewards           = empty

-- ─────────────────────────────────────────────────────────────────────────────
-- A. Promised rates, snapshotted at submission
-- ─────────────────────────────────────────────────────────────────────────────
-- default 0 with NO backfill UPDATE: the 3 live referral rows (1 joined,
-- 2 rejected) can never retroactively mint a reward.
alter table public.hms_referrals
  add column if not exists promised_referrer_percent smallint not null default 0,
  add column if not exists promised_referred_percent smallint not null default 0,
  add column if not exists rewards_skipped_reason    text;

alter table public.hms_referrals
  drop constraint if exists hms_referrals_promised_percent_range;
alter table public.hms_referrals
  add constraint hms_referrals_promised_percent_range
  check (promised_referrer_percent between 0 and 100
     and promised_referred_percent between 0 and 100);

-- Lifetime anti-recycling probe. Without this, flipping a tenant to the waiting
-- list and back re-attributes the same phone number indefinitely, because the
-- pending-uniqueness index in 173 covers only status = 'pending'.
create index if not exists hms_referrals_owner_phone_joined_idx
  on public.hms_referrals (owner_id, phone_digits) where status = 'joined';

-- ─────────────────────────────────────────────────────────────────────────────
-- B. Canonical phone digits on hms_tenants
-- ─────────────────────────────────────────────────────────────────────────────
-- Attribution matches on phone, so the self-referral guard must too — keying it
-- on tenant_id is defeated by a re-admission, which mints a fresh uuid for the
-- same person.
--
-- This is lib/phone.ts normalizePhoneDigits() transliterated: same 10/15 bounds,
-- same "peel 00 before 0" ordering, same 92 country code. The two MUST agree;
-- a differential test over all 730 tenant rows proves it before this ships.
create or replace function public.hms_normalize_phone_digits(p text)
returns text
language plpgsql
immutable
set search_path = public
as $$
DECLARE d text;
BEGIN
  IF p IS NULL OR btrim(p) = '' THEN RETURN NULL; END IF;
  d := regexp_replace(p, '\D', '', 'g');
  IF length(d) < 10 THEN RETURN NULL; END IF;
  IF left(d, 2) = '00' THEN d := substr(d, 3); END IF;
  IF left(d, 1) = '0' THEN
    d := '92' || substr(d, 2);
  ELSIF left(d, 2) <> '92' AND length(d) = 10 THEN
    d := '92' || d;
  END IF;
  IF length(d) < 10 OR length(d) > 15 THEN RETURN NULL; END IF;
  RETURN d;
END;
$$;

alter table public.hms_tenants
  add column if not exists phone_digits text
  generated always as (public.hms_normalize_phone_digits(phone)) stored;

create index if not exists hms_tenants_phone_digits_idx
  on public.hms_tenants (hostel_id, phone_digits) where phone_digits is not null;
create index if not exists hms_tenants_phone_digits_global_idx
  on public.hms_tenants (phone_digits) where phone_digits is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- C. The bill-side columns. BOTH are trigger-owned; no caller value survives.
-- ─────────────────────────────────────────────────────────────────────────────
-- referral_percent is stored, not just the rupees, because a collected bill must
-- be able to RE-DERIVE the same discount off a rent that moved (checkout
-- pro-rating) and must stay stable when the ledger row is voided or cascaded
-- away underneath it.
alter table public.hms_payments
  add column if not exists referral_discount numeric(10,2) not null default 0,
  add column if not exists referral_percent  smallint      not null default 0;

alter table public.hms_payments
  drop constraint if exists hms_payments_referral_discount_nonneg;
alter table public.hms_payments
  add constraint hms_payments_referral_discount_nonneg
  check (referral_discount >= 0);

alter table public.hms_payments
  drop constraint if exists hms_payments_referral_percent_range;
alter table public.hms_payments
  add constraint hms_payments_referral_percent_range
  check (referral_percent between 0 and 100);

-- ─────────────────────────────────────────────────────────────────────────────
-- D. The reward ledger
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.hms_referral_rewards (
  id                 uuid primary key default gen_random_uuid(),

  -- ON DELETE SET NULL, not CASCADE. Deleting the referrer's tenant row cascades
  -- hms_referral_codes -> hms_referrals; a reward is money and must outlive that,
  -- or an uncollected bill silently re-prices upward. Everything the UI needs to
  -- render an orphaned reward is snapshotted below.
  referral_id        uuid references public.hms_referrals(id) on delete set null,

  owner_id           uuid not null references auth.users(id)         on delete cascade,
  -- The branch that GRANTS and BILLS this side.
  hostel_id          uuid not null references public.hms_hostels(id) on delete cascade,
  -- The beneficiary. Cascade is correct: their own bills go with them.
  tenant_id          uuid not null references public.hms_tenants(id) on delete cascade,
  role               text not null check (role in ('referred','referrer')),

  -- Snapshots. counterparty_name is what Marketing renders once referral_id has
  -- been nulled by a cascade. matched_tenant_id is denormalised so the release
  -- job needs no join on the collection hot path.
  counterparty_name  text,
  referrer_tenant_id uuid,
  matched_tenant_id  uuid,

  -- Never a rupee amount: percent <= 100 of base rent is what makes the trigger's
  -- negative-amount RAISE unreachable by construction.
  percent            smallint not null check (percent between 1 and 100),

  status             text not null default 'scheduled'
                     check (status in ('scheduled','held','applied','expired','void')),

  for_month          text check (for_month ~ '^\d{4}-\d{2}$'),
  earliest_month     text not null check (earliest_month ~ '^\d{4}-\d{2}$'),
  expires_on         date not null,

  applied_amount     numeric(10,2) check (applied_amount is null or applied_amount >= 0),
  applied_payment_id uuid references public.hms_payments(id) on delete set null,
  qualified_at       timestamptz,
  applied_at         timestamptz,
  expired_at         timestamptz,
  voided_at          timestamptz,
  void_reason        text,
  -- Stamped once the referrer has been told, so the notification fires once.
  notified_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint hms_referral_rewards_placed
    check (status not in ('scheduled','applied') or for_month is not null),
  constraint hms_referral_rewards_held_unplaced
    check (status <> 'held' or for_month is null)
);

-- A referral credits each side at most once, ever. Partial on status so a
-- re-grant can land over a voided row. A NULL referral_id (post-cascade) does not
-- participate, which is correct: an orphan can never be re-granted.
create unique index if not exists hms_referral_rewards_one_per_role
  on public.hms_referral_rewards (referral_id, role) where status <> 'void';

-- ONE discount per bill, ever. hms_payments is already unique on
-- (tenant_id, for_month), so this is 1:1 with a bill. IT IS THE TRIGGER'S PROBE
-- INDEX — there is deliberately no second index on this key.
create unique index if not exists hms_referral_rewards_one_per_bill
  on public.hms_referral_rewards (tenant_id, for_month)
  where status in ('scheduled', 'applied');

create index if not exists hms_referral_rewards_open_idx
  on public.hms_referral_rewards (hostel_id, status) where status in ('scheduled','held');
-- The release job's probe. An empty partial index for every branch that never
-- enables this.
create index if not exists hms_referral_rewards_held_match_idx
  on public.hms_referral_rewards (matched_tenant_id) where status = 'held';
create index if not exists hms_referral_rewards_referral_idx
  on public.hms_referral_rewards (referral_id);
create index if not exists hms_referral_rewards_tenant_idx
  on public.hms_referral_rewards (tenant_id, status);

-- Same posture as hms_referrals (migration 173): RLS on, ZERO policies, no
-- grants. Every read and write goes through createAdminClient().
alter table public.hms_referral_rewards enable row level security;
revoke all on public.hms_referral_rewards from anon, authenticated;

drop trigger if exists hms_referral_rewards_updated_at on public.hms_referral_rewards;
create trigger hms_referral_rewards_updated_at before update
  on public.hms_referral_rewards for each row
  execute function public.hms_set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- E. The percentages are money now. Guard them like referral_enabled.
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 094 grants a tier='full' partner UPDATE on hms_hostels; 173's trigger
-- guards only referral_enabled. That was harmless while these two columns were
-- display-only. They are not any more — a partner could PATCH them to 100.
--
-- Non-breaking: the only legitimate writer, updateReferralPercentages, uses
-- createAdminClient() where auth.uid() is NULL. createBranch never sets them and
-- the column default is 0, so the INSERT branch never fires either.
create or replace function public.hms_prevent_referral_self_grant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.referral_enabled AND auth.uid() IS NOT NULL THEN
      RAISE EXCEPTION 'Forbidden: referral_enabled can only be set by Super Admin';
    END IF;
    IF (coalesce(NEW.referral_referrer_percent, 0) <> 0
     OR coalesce(NEW.referral_referred_percent, 0) <> 0)
     AND auth.uid() IS NOT NULL THEN
      RAISE EXCEPTION 'Forbidden: referral percentages are set through the Marketing page, not directly';
    END IF;
  ELSE
    IF NEW.referral_enabled IS DISTINCT FROM OLD.referral_enabled AND auth.uid() IS NOT NULL THEN
      RAISE EXCEPTION 'Forbidden: referral_enabled can only be changed by Super Admin';
    END IF;
    IF (NEW.referral_referrer_percent IS DISTINCT FROM OLD.referral_referrer_percent
     OR NEW.referral_referred_percent IS DISTINCT FROM OLD.referral_referred_percent)
     AND auth.uid() IS NOT NULL THEN
      RAISE EXCEPTION 'Forbidden: referral percentages are set through the Marketing page, not directly';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
