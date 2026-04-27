-- Public hostel listing: opt-in directory for tenants to find hostels

alter table hms_hostels
  add column if not exists city           text,
  add column if not exists area           text,
  add column if not exists maps_url       text,
  add column if not exists description    text,
  add column if not exists hostel_type    text check (hostel_type in ('boys','girls','mixed','family')),
  add column if not exists amenities      text[] default '{}',
  add column if not exists listing_enabled boolean default false not null;

-- Public read access for listed hostels (anon + authenticated)
create policy "Public can view listed hostels"
  on hms_hostels for select
  using (listing_enabled = true);
