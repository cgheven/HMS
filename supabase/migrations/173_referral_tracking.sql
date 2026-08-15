-- Referral tracking, phase 1 of the referral feature: links, submissions and
-- attribution. NO money. Nothing here touches hms_payments, the recalculation
-- trigger, or any of the four tenant-creation paths.
--
-- Everything below is additive:
--   * two brand-new tables that nothing existing reads;
--   * one new column on hms_hostels, NOT NULL DEFAULT false, so all 15 branches
--     are switched off the instant this lands.
-- Until a Super Admin enables a branch, no surface renders and no referral can
-- be created for anyone. That default is the safety property, not the RLS.
--
-- Deliberately NOT here: referral_discount_charge, the trigger rewrite,
-- commission accrual, and the write-time hook into tenant creation. Attribution
-- is derived by phone at READ time (when the Marketing page loads) precisely so
-- that admitting a tenant runs no new code for any client.

-- ── Per-branch entitlement ───────────────────────────────────────────────────
alter table public.hms_hostels
  add column if not exists referral_enabled boolean not null default false;

-- A separate guard function rather than extending hms_prevent_whatsapp_self_grant:
-- that one is load-bearing for a live entitlement and must not be edited to add
-- an unrelated column. Two BEFORE triggers on one table are fine — each only
-- raises or returns NEW.
--
-- The test is 'auth.uid() IS NOT NULL', copied verbatim from 172. It reads as
-- "only the service role may set this". Using hms_is_super_admin() instead would
-- look more correct and would BREAK every Super Admin write, because under
-- service_role auth.uid() is null and that function then returns false.
--
-- INSERT as well as UPDATE: guarding UPDATE alone is exactly the hole that let an
-- owner create a branch with whatsapp_enabled already true (migration 172).
-- TG_OP branching is required because OLD is unassigned in a BEFORE INSERT.
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
  ELSE
    IF NEW.referral_enabled IS DISTINCT FROM OLD.referral_enabled AND auth.uid() IS NOT NULL THEN
      RAISE EXCEPTION 'Forbidden: referral_enabled can only be changed by Super Admin';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

drop trigger if exists hms_block_referral_self_grant on public.hms_hostels;
create trigger hms_block_referral_self_grant
  before insert or update on public.hms_hostels
  for each row execute function public.hms_prevent_referral_self_grant();

-- ── One shareable code per tenant ────────────────────────────────────────────
create table if not exists public.hms_referral_codes (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.hms_tenants(id) on delete cascade,
  hostel_id  uuid not null references public.hms_hostels(id) on delete cascade,
  -- Generated in app code from an alphabet with no 0/O/1/I/L, so a code read
  -- aloud over the phone cannot be mistyped.
  code       text not null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Global, not per-hostel: a code is resolved from the URL alone, before any
-- hostel is known, so it must identify exactly one row across the whole table.
create unique index if not exists hms_referral_codes_code_key
  on public.hms_referral_codes (lower(code));

-- Rotation keeps history: an abused code is deactivated, not deleted, and the
-- old rows stay attributable. Only one code may be live per tenant at a time.
create unique index if not exists hms_referral_codes_one_active_per_tenant
  on public.hms_referral_codes (tenant_id) where is_active;

create index if not exists hms_referral_codes_hostel_idx
  on public.hms_referral_codes (hostel_id) where is_active;

-- ── Submissions ─────────────────────────────────────────────────────────────
create table if not exists public.hms_referrals (
  id                 uuid primary key default gen_random_uuid(),
  code_id            uuid not null references public.hms_referral_codes(id) on delete cascade,
  referrer_tenant_id uuid not null references public.hms_tenants(id) on delete cascade,
  hostel_id          uuid not null references public.hms_hostels(id) on delete cascade,
  -- Denormalised at insert so "first submission wins" can be enforced by a unique
  -- index. The rule is per OWNER, not per branch: a referral pays out when the
  -- person joins ANY branch that owner owns, so the same phone must not be
  -- claimable twice across their branches. Deriving this via a join at write time
  -- cannot be expressed as a unique index.
  owner_id           uuid not null references auth.users(id) on delete cascade,
  name               text not null,
  -- Raw as typed, for display. Never matched on.
  phone              text not null,
  -- normalizePhoneDigits() output. The ONLY column matching ever reads, so
  -- 0300…, +92300… and 92300… resolve to one person.
  phone_digits       text not null,
  status             text not null default 'pending'
                     check (status in ('pending', 'joined', 'rejected', 'expired')),
  matched_tenant_id  uuid references public.hms_tenants(id) on delete set null,
  matched_at         timestamptz,
  rejected_at        timestamptz,
  rejected_by        uuid references auth.users(id) on delete set null,
  -- Abuse forensics only, mirroring hms_platform_leads.ip_address. Never shown.
  ip_address         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- "First submission wins", enforced by the database rather than by whichever
-- code path happened to run first. Scoped to pending because a person who
-- joined, left, and is later referred again is a legitimate new referral.
create unique index if not exists hms_referrals_one_pending_per_phone_per_owner
  on public.hms_referrals (owner_id, phone_digits) where status = 'pending';

-- The Marketing page reads by branch and status; matching reads by phone.
create index if not exists hms_referrals_hostel_status_idx
  on public.hms_referrals (hostel_id, status, created_at desc);
create index if not exists hms_referrals_phone_idx
  on public.hms_referrals (phone_digits) where status = 'pending';
create index if not exists hms_referrals_referrer_idx
  on public.hms_referrals (referrer_tenant_id, created_at desc);

-- ── Access ──────────────────────────────────────────────────────────────────
-- RLS on with NO policies, matching hms_lead_activities and
-- hms_lead_campaign_sends: only the service role reaches these, and every read
-- and write goes through a super-admin- or owner-guarded server action.
--
-- The REVOKE is belt and braces on top. Supabase's default grants hand anon and
-- authenticated full table privileges, and RLS is the only thing standing in
-- front of them — that combination is exactly what leaked
-- hms_whatsapp_messages to the public anon key this week. Two independent
-- barriers, so forgetting one does not expose 603 tenants' referral contacts.
alter table public.hms_referral_codes enable row level security;
alter table public.hms_referrals      enable row level security;

revoke all on public.hms_referral_codes from anon, authenticated;
revoke all on public.hms_referrals      from anon, authenticated;

drop trigger if exists hms_referral_codes_updated_at on public.hms_referral_codes;
create trigger hms_referral_codes_updated_at
  before update on public.hms_referral_codes
  for each row execute function public.hms_set_updated_at();

drop trigger if exists hms_referrals_updated_at on public.hms_referrals;
create trigger hms_referrals_updated_at
  before update on public.hms_referrals
  for each row execute function public.hms_set_updated_at();
