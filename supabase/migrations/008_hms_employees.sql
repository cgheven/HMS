create table if not exists hms_employees (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid not null references hms_hostels(id) on delete cascade,
  full_name text not null,
  role text not null default 'other',
  phone text,
  cnic text,
  join_date date not null default current_date,
  monthly_salary numeric(10,2) not null default 0,
  status text not null default 'active',
  notes text,
  created_at timestamptz default now()
);

create table if not exists hms_salary_payments (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid not null references hms_hostels(id) on delete cascade,
  employee_id uuid not null references hms_employees(id) on delete cascade,
  for_month text not null,
  amount numeric(10,2) not null default 0,
  status text not null default 'pending',
  payment_method text,
  payment_date date,
  notes text,
  receipt_number text,
  created_at timestamptz default now(),
  unique(employee_id, for_month)
);

alter table hms_employees enable row level security;
alter table hms_salary_payments enable row level security;

create policy "Owner manages employees" on hms_employees for all
  using (exists (select 1 from hms_hostels where hms_hostels.id = hms_employees.hostel_id and hms_hostels.owner_id = auth.uid()))
  with check (exists (select 1 from hms_hostels where hms_hostels.id = hms_employees.hostel_id and hms_hostels.owner_id = auth.uid()));

create policy "Owner manages salary payments" on hms_salary_payments for all
  using (exists (select 1 from hms_hostels where hms_hostels.id = hms_salary_payments.hostel_id and hms_hostels.owner_id = auth.uid()))
  with check (exists (select 1 from hms_hostels where hms_hostels.id = hms_salary_payments.hostel_id and hms_hostels.owner_id = auth.uid()));
