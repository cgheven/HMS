-- HotelEye (Smart Eye) police-verification integration.
--
-- Hostel owners in Pakistan are legally required to file every guest into the
-- provincial "Smart Eye" portal. This lets PulseHub submit that data for them
-- from the tenant records it already holds, one authenticated session at a time.
--
-- Two pieces of new state:
--   1. per-hostel portal credentials (the password is stored ENCRYPTED — see
--      lib/secret-box.ts; the column never holds plaintext);
--   2. per-tenant province/district (the portal demands structured values, not
--      the free-text permanent_address HMS already stores) and a sync status.
--
-- Additive and nullable throughout. Every existing hostel starts with no
-- credentials (integration simply not set up) and every existing tenant starts
-- not_synced, which is exactly what they are.

-- ── Per-hostel portal credentials ────────────────────────────────────────
create table if not exists public.hms_hotel_eye_credentials (
  hostel_id          uuid primary key references public.hms_hostels(id) on delete cascade,
  -- Per PROVINCE, so the base URL is stored per hostel rather than hardcoded.
  portal_url         text not null default 'https://hoteleye.punjab.gov.pk',
  username           text not null,
  -- AES-256-GCM ciphertext (iv:tag:data, base64) — NEVER plaintext. Written and
  -- read only by server code holding HOTEL_EYE_ENC_KEY; never sent to a browser.
  password_encrypted text not null,
  -- Defaults offered when a tenant has no province/district of their own, so a
  -- hostel that only ever books locals need not set them per guest.
  default_province   text,
  default_district   text,
  -- Bookkeeping for the owner-facing page; not security-bearing.
  last_synced_at     timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on column public.hms_hotel_eye_credentials.password_encrypted is
  'AES-256-GCM ciphertext of the portal password. Decrypted only server-side with HOTEL_EYE_ENC_KEY. Must never be selected into a client payload.';

-- Zero policies by design: this table is reached only through the service-role
-- client inside server actions, never from the browser. RLS on with no policy
-- denies all anon/authenticated access, which is the intent.
alter table public.hms_hotel_eye_credentials enable row level security;

-- ── Per-tenant structured origin + sync status ───────────────────────────
alter table public.hms_tenants
  add column if not exists permanent_province text,
  add column if not exists permanent_district text,
  -- not_synced | synced | failed. No 'n/a' column: a hostel with no credentials
  -- simply never surfaces the badge, decided in the app, so the status stays a
  -- pure fact about whether THIS tenant has been filed.
  add column if not exists hotel_eye_status text not null default 'not_synced',
  add column if not exists hotel_eye_synced_at timestamptz,
  -- The remote record id returned by the portal, so a re-sync can tell "already
  -- filed" from "needs filing" without re-scraping the whole watch list.
  add column if not exists hotel_eye_entry_id text;

-- The pending-queue query on the Police Verification page: "who in this hostel
-- still needs filing?" Partial, so it stays small — most tenants end up synced.
create index if not exists hms_tenants_hotel_eye_pending_idx
  on public.hms_tenants (hostel_id)
  where hotel_eye_status <> 'synced';
