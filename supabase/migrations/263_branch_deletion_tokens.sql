-- Migration 263: self-service branch deletion via an emailed confirmation link.
--
-- An owner requests deletion of one of their branches; we email a single-use,
-- 30-minute, hashed-token link (same shape as signup-verify / email-change).
-- Clicking it, while logged in as that owner, permanently deletes the branch
-- (cascade) and reconciles their subscription tier down. No support involvement.
--
-- Accessed ONLY via the service-role (admin) client from the request/confirm
-- server actions: RLS enabled with NO policies → denied to every normal user.

create table if not exists public.hms_pending_branch_deletions (
  id          uuid default gen_random_uuid() primary key,
  hostel_id   uuid not null references public.hms_hostels(id) on delete cascade,
  owner_id    uuid not null references auth.users(id)        on delete cascade,
  token_hash  text not null,
  expires_at  timestamptz not null,
  consumed_at timestamptz,
  created_at  timestamptz default now() not null
);

create index if not exists idx_pending_branch_del_token
  on public.hms_pending_branch_deletions (token_hash);

alter table public.hms_pending_branch_deletions enable row level security;
