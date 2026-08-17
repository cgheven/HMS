-- Referral campaign: one-click start, auto-send on admission, pause, and a
-- per-tenant status page.
--
-- No new tables. hms_referral_codes already holds exactly one live row per
-- tenant (partial unique on tenant_id WHERE is_active), so "the token for this
-- tenant" and "have we sent this tenant their link" are columns on that row.
-- Rotation inserts a NEW row, which arrives with a fresh token and a null
-- link_sent_at — which is precisely the requested rule: one message per tenant
-- per code, re-sent only when the code changes.

-- The tenant's private status-page credential. Only the SHA-256 digest is
-- stored; the raw token exists once, in the WhatsApp message. Same shape as
-- hms_feedback_tokens (migration 161).
alter table public.hms_referral_codes
  add column if not exists status_token_hash text,
  add column if not exists link_sent_at timestamptz;

alter table public.hms_referral_codes
  drop constraint if exists hms_referral_codes_status_token_hash_format;
alter table public.hms_referral_codes
  add constraint hms_referral_codes_status_token_hash_format
  check (status_token_hash is null or status_token_hash ~ '^[0-9a-f]{64}$');

-- Lookup is by digest on an unauthenticated route, so it must be indexed and
-- collision-free.
create unique index if not exists hms_referral_codes_status_token_hash_key
  on public.hms_referral_codes (status_token_hash)
  where status_token_hash is not null;

-- Which tenants are still owed their link. Empty for every branch that never
-- starts a campaign.
create index if not exists hms_referral_codes_unsent_idx
  on public.hms_referral_codes (hostel_id)
  where is_active and link_sent_at is null;

-- off    — never started. No sends, and nothing on screen changes.
-- active — new tenants are messaged automatically as they are admitted.
-- paused — no sends; existing links tell the holder the campaign is paused.
--          Referrals ALREADY submitted are untouched and still pay out:
--          pausing outbound marketing must never break a promise already made.
alter table public.hms_hostels
  add column if not exists referral_campaign text not null default 'off';

alter table public.hms_hostels
  drop constraint if exists hms_hostels_referral_campaign_check;
alter table public.hms_hostels
  add constraint hms_hostels_referral_campaign_check
  check (referral_campaign in ('off', 'active', 'paused'));
