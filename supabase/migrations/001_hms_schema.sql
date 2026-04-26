-- HMS Schema — all tables prefixed hms_ for isolation
-- Run this in Supabase SQL Editor

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ============================================================
-- PROFILES (extends Supabase auth.users)
-- ============================================================
create table if not exists hms_profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  email text not null,
  full_name text,
  avatar_url text,
  created_at timestamptz default now() not null
);

alter table hms_profiles enable row level security;

create policy "Users see own profile"
  on hms_profiles for select
  using (auth.uid() = id);

create policy "Users update own profile"
  on hms_profiles for update
  using (auth.uid() = id);

-- Auto-create profile on signup
create or replace function hms_handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into hms_profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

drop trigger if exists hms_on_auth_user_created on auth.users;
create trigger hms_on_auth_user_created
  after insert on auth.users
  for each row execute procedure hms_handle_new_user();

-- ============================================================
-- HOSTELS
-- ============================================================
create table if not exists hms_hostels (
  id uuid default uuid_generate_v4() primary key,
  owner_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  address text,
  phone text,
  email text,
  total_capacity integer default 0 not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

alter table hms_hostels enable row level security;

create policy "Owner manages own hostel"
  on hms_hostels for all
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

-- Auto-create hostel on profile creation
create or replace function hms_handle_new_profile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into hms_hostels (owner_id, name)
  values (new.id, 'My Hostel');
  return new;
end;
$$;

drop trigger if exists hms_on_profile_created on hms_profiles;
create trigger hms_on_profile_created
  after insert on hms_profiles
  for each row execute procedure hms_handle_new_profile();

-- ============================================================
-- ROOMS
-- ============================================================
create table if not exists hms_rooms (
  id uuid default uuid_generate_v4() primary key,
  hostel_id uuid references hms_hostels(id) on delete cascade not null,
  room_number text not null,
  floor integer,
  type text check (type in ('student','professional','general')) default 'general' not null,
  capacity integer default 1 not null,
  occupied integer default 0 not null,
  monthly_rent numeric(10,2) default 0 not null,
  status text check (status in ('available','occupied','maintenance')) default 'available' not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

alter table hms_rooms enable row level security;

create policy "Owner manages own rooms"
  on hms_rooms for all
  using (
    exists (
      select 1 from hms_hostels
      where hms_hostels.id = hms_rooms.hostel_id
        and hms_hostels.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from hms_hostels
      where hms_hostels.id = hms_rooms.hostel_id
        and hms_hostels.owner_id = auth.uid()
    )
  );

-- ============================================================
-- TENANTS
-- ============================================================
create table if not exists hms_tenants (
  id uuid default uuid_generate_v4() primary key,
  hostel_id uuid references hms_hostels(id) on delete cascade not null,
  room_id uuid references hms_rooms(id) on delete set null,
  full_name text not null,
  phone text,
  email text,
  cnic text,
  type text check (type in ('student','professional','general')) default 'general' not null,
  check_in date not null default current_date,
  check_out date,
  monthly_rent numeric(10,2) default 0 not null,
  is_active boolean default true not null,
  created_at timestamptz default now() not null
);

alter table hms_tenants enable row level security;

create policy "Owner manages own tenants"
  on hms_tenants for all
  using (
    exists (
      select 1 from hms_hostels
      where hms_hostels.id = hms_tenants.hostel_id
        and hms_hostels.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from hms_hostels
      where hms_hostels.id = hms_tenants.hostel_id
        and hms_hostels.owner_id = auth.uid()
    )
  );

-- ============================================================
-- EXPENSES
-- ============================================================
create table if not exists hms_expenses (
  id uuid default uuid_generate_v4() primary key,
  hostel_id uuid references hms_hostels(id) on delete cascade not null,
  title text not null,
  amount numeric(10,2) not null,
  category text check (
    category in ('furniture','repairs','cleaning','security','utilities','other')
  ) default 'other' not null,
  date date not null default current_date,
  notes text,
  created_at timestamptz default now() not null
);

alter table hms_expenses enable row level security;

create policy "Owner manages own expenses"
  on hms_expenses for all
  using (
    exists (
      select 1 from hms_hostels
      where hms_hostels.id = hms_expenses.hostel_id
        and hms_hostels.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from hms_hostels
      where hms_hostels.id = hms_expenses.hostel_id
        and hms_hostels.owner_id = auth.uid()
    )
  );

-- ============================================================
-- KITCHEN EXPENSES
-- ============================================================
create table if not exists hms_kitchen_expenses (
  id uuid default uuid_generate_v4() primary key,
  hostel_id uuid references hms_hostels(id) on delete cascade not null,
  title text not null,
  amount numeric(10,2) not null,
  date date not null default current_date,
  notes text,
  created_at timestamptz default now() not null
);

alter table hms_kitchen_expenses enable row level security;

create policy "Owner manages own kitchen expenses"
  on hms_kitchen_expenses for all
  using (
    exists (
      select 1 from hms_hostels
      where hms_hostels.id = hms_kitchen_expenses.hostel_id
        and hms_hostels.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from hms_hostels
      where hms_hostels.id = hms_kitchen_expenses.hostel_id
        and hms_hostels.owner_id = auth.uid()
    )
  );

-- ============================================================
-- FOOD ITEMS (Daily Food List)
-- ============================================================
create table if not exists hms_food_items (
  id uuid default uuid_generate_v4() primary key,
  hostel_id uuid references hms_hostels(id) on delete cascade not null,
  date date not null default current_date,
  meal_type text check (meal_type in ('breakfast','lunch','dinner','snack')) not null,
  item_name text not null,
  quantity text,
  unit_cost numeric(10,2),
  notes text,
  created_at timestamptz default now() not null
);

alter table hms_food_items enable row level security;

create policy "Owner manages own food items"
  on hms_food_items for all
  using (
    exists (
      select 1 from hms_hostels
      where hms_hostels.id = hms_food_items.hostel_id
        and hms_hostels.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from hms_hostels
      where hms_hostels.id = hms_food_items.hostel_id
        and hms_hostels.owner_id = auth.uid()
    )
  );

-- ============================================================
-- BILLS
-- ============================================================
create table if not exists hms_bills (
  id uuid default uuid_generate_v4() primary key,
  hostel_id uuid references hms_hostels(id) on delete cascade not null,
  title text not null,
  category text check (
    category in ('electricity','water','internet','gas','maintenance','other')
  ) default 'other' not null,
  amount numeric(10,2) not null,
  due_date date not null,
  paid_date date,
  status text check (status in ('paid','unpaid','overdue')) default 'unpaid' not null,
  notes text,
  created_at timestamptz default now() not null
);

alter table hms_bills enable row level security;

create policy "Owner manages own bills"
  on hms_bills for all
  using (
    exists (
      select 1 from hms_hostels
      where hms_hostels.id = hms_bills.hostel_id
        and hms_hostels.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from hms_hostels
      where hms_hostels.id = hms_bills.hostel_id
        and hms_hostels.owner_id = auth.uid()
    )
  );

-- ============================================================
-- UPDATED_AT trigger helper
-- ============================================================
create or replace function hms_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger hms_hostels_updated_at before update on hms_hostels
  for each row execute procedure hms_set_updated_at();

create trigger hms_rooms_updated_at before update on hms_rooms
  for each row execute procedure hms_set_updated_at();
