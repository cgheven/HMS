-- Waitlist for fully-booked public hostel listings

create table if not exists hms_waitlist (
  id         uuid        primary key default gen_random_uuid(),
  hostel_id  uuid        references hms_hostels(id) on delete cascade not null,
  name       text        not null,
  phone      text        not null,
  created_at timestamptz not null default now()
);

alter table hms_waitlist enable row level security;

-- Anyone can join a waitlist (public action)
create policy "Anyone can join waitlist"
  on hms_waitlist for insert
  with check (true);

-- Only the hostel owner can see their waitlist
create policy "Owner reads own waitlist"
  on hms_waitlist for select
  using (
    exists (
      select 1 from hms_hostels
      where hms_hostels.id = hms_waitlist.hostel_id
        and hms_hostels.owner_id = auth.uid()
    )
  );

create index on hms_waitlist (hostel_id, created_at desc);
