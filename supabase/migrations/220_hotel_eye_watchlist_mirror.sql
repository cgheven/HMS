-- A local mirror of each hotel's portal watch list, so dedupe compares against
-- OUR database instead of hitting the government portal for every check.
--
-- Populated two ways: (1) refreshed from the portal watch list whenever we have
-- a live session (i.e. during a sync — one read, then stored), and (2) written
-- the instant WE file a guest. Dedupe then reads this table, never the portal,
-- and falls back to it if a live read fails mid-sync. The timeline columns make
-- it auditable: who is on the portal, since when, last confirmed when.
--
-- cnic is stored DIGITS-ONLY (normalized) so "34501-6752651-3" and the bare
-- 13 digits compare equal. Reached solely through the service-role admin client,
-- matching the zero-policy RLS of hms_hotel_eye_credentials.

create table if not exists public.hms_hotel_eye_watchlist (
  hostel_id uuid not null references public.hms_hostels(id) on delete cascade,
  cnic text not null,
  name text,
  source text not null default 'portal',   -- 'portal' | 'filed_by_us'
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (hostel_id, cnic)
);

alter table public.hms_hotel_eye_watchlist enable row level security;
-- Deliberately no policies: only the server's admin client touches this table.
