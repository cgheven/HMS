-- Owner-configurable referral percentages, per branch.
--
-- On hms_hostels rather than a hms_referral_settings table for one concrete
-- reason: the PUBLIC /ref/[code] resolver already reads hms_hostels to check
-- referral_enabled, so the percentage it must display costs zero extra queries.
-- A separate table would add a join to an unauthenticated, rate-limited path
-- that every stranger hits.
--
-- Deliberately NOT guarded by a self-grant trigger, unlike referral_enabled.
-- The entitlement is ours to grant; the discount is the OWNER's money and their
-- commercial decision, so they set it themselves through the Marketing page via
-- the existing "Owner manages own hostel" policy.
--
-- Phase 1 uses these for DISPLAY ONLY — the public page tells a visitor what
-- they will get, and the owner applies it by hand at admission. Phase 2 reads
-- the same two columns when it automates the payout, so the number a stranger
-- was promised and the number eventually applied cannot drift apart.
--
-- 0 is allowed and meaningful: referred_percent = 0 is the "referrer only"
-- mode, and the public page then omits the visitor-facing offer instead of
-- promising nothing. The upper bound is 100 rather than something tighter
-- because a full free month is a legitimate promotion an owner may choose to
-- run; it is their revenue to spend.

alter table public.hms_hostels
  add column if not exists referral_referrer_percent integer not null default 10,
  add column if not exists referral_referred_percent integer not null default 10;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'hms_hostels_referral_percent_range'
  ) then
    alter table public.hms_hostels
      add constraint hms_hostels_referral_percent_range
      check (
        referral_referrer_percent between 0 and 100
        and referral_referred_percent between 0 and 100
      );
  end if;
end $$;
