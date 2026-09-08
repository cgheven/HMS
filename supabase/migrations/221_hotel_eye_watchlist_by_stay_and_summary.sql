-- Two refinements to the Smart Eye / Hotel Eye sync:
--
-- 1) Dedupe by STAY, not just person. Hostels see the same guest return for new
--    stays, and each stay is a separate legally-required filing. So the watch-list
--    mirror is keyed on (hostel_id, cnic, check_in): a returning CNIC with a NEW
--    check-in date is a new entry to file, not a duplicate to skip. Only a
--    same-CNIC + same-check-in row is a true duplicate. check_in is YYYY-MM-DD
--    ('' when the portal cell couldn't be read). The 220 table is brand-new and
--    empty (no syncs yet on prod), so recreating it loses nothing.
--
-- 2) A per-hostel "last sync" summary so the result is visible whenever the owner
--    returns, even though the sync runs in the background: counts + finish time.

drop table if exists public.hms_hotel_eye_watchlist;

create table public.hms_hotel_eye_watchlist (
  hostel_id uuid not null references public.hms_hostels(id) on delete cascade,
  cnic text not null,
  check_in text not null default '',   -- YYYY-MM-DD (the stay); '' if unknown
  name text,
  source text not null default 'portal',   -- 'portal' | 'filed_by_us'
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (hostel_id, cnic, check_in)
);

alter table public.hms_hotel_eye_watchlist enable row level security;
-- Deliberately no policies: only the server's admin client touches this table.

alter table public.hms_hotel_eye_credentials
  add column if not exists last_sync_filed integer,
  add column if not exists last_sync_matched integer,
  add column if not exists last_sync_failed integer,
  add column if not exists last_sync_at timestamptz,
  -- Set when a run couldn't complete (e.g. the portal read failed), so the owner
  -- gets feedback instead of the queue silently reverting to pending; null on a
  -- run that finished.
  add column if not exists last_sync_note text;
