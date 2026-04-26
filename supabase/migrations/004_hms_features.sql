-- 004: Core HMS features — tenants enhancements, payments, complaints, announcements

-- ============================================================
-- ENHANCE hms_tenants
-- ============================================================
alter table hms_tenants
  add column if not exists bed_number        text,
  add column if not exists emergency_contact text,
  add column if not exists emergency_phone   text,
  add column if not exists security_deposit  numeric(10,2) default 0 not null,
  add column if not exists notes             text,
  add column if not exists is_waiting        boolean default false not null;

-- ============================================================
-- hms_payments  (one record per tenant per month)
-- ============================================================
create table if not exists hms_payments (
  id              uuid default uuid_generate_v4() primary key,
  hostel_id       uuid references hms_hostels(id) on delete cascade not null,
  tenant_id       uuid references hms_tenants(id) on delete cascade not null,
  for_month       text not null,  -- 'YYYY-MM'
  amount          numeric(10,2) not null,
  late_fee        numeric(10,2) default 0 not null,
  payment_method  text check (payment_method in ('cash','bank_transfer','jazzcash','easypaisa','sadapay','other')),
  payment_date    date,
  status          text check (status in ('paid','pending','overdue','waived')) default 'pending' not null,
  receipt_number  text,
  notes           text,
  created_at      timestamptz default now() not null,
  updated_at      timestamptz default now() not null,
  unique (tenant_id, for_month)
);

alter table hms_payments enable row level security;

create policy "Owner manages own payments"
  on hms_payments for all
  using (
    exists (
      select 1 from hms_hostels
      where hms_hostels.id = hms_payments.hostel_id
        and hms_hostels.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from hms_hostels
      where hms_hostels.id = hms_payments.hostel_id
        and hms_hostels.owner_id = auth.uid()
    )
  );

create trigger hms_payments_updated_at before update on hms_payments
  for each row execute procedure hms_set_updated_at();

-- ============================================================
-- hms_complaints  (maintenance & complaints)
-- ============================================================
create table if not exists hms_complaints (
  id               uuid default uuid_generate_v4() primary key,
  hostel_id        uuid references hms_hostels(id) on delete cascade not null,
  tenant_id        uuid references hms_tenants(id) on delete set null,
  room_id          uuid references hms_rooms(id)   on delete set null,
  title            text not null,
  description      text,
  category         text check (category in ('plumbing','electricity','cleanliness','security','furniture','other')) default 'other' not null,
  priority         text check (priority in ('low','medium','high')) default 'medium' not null,
  status           text check (status in ('open','in_progress','resolved')) default 'open' not null,
  resolution_notes text,
  resolved_at      timestamptz,
  created_at       timestamptz default now() not null,
  updated_at       timestamptz default now() not null
);

alter table hms_complaints enable row level security;

create policy "Owner manages own complaints"
  on hms_complaints for all
  using (
    exists (
      select 1 from hms_hostels
      where hms_hostels.id = hms_complaints.hostel_id
        and hms_hostels.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from hms_hostels
      where hms_hostels.id = hms_complaints.hostel_id
        and hms_hostels.owner_id = auth.uid()
    )
  );

create trigger hms_complaints_updated_at before update on hms_complaints
  for each row execute procedure hms_set_updated_at();

-- ============================================================
-- hms_announcements
-- ============================================================
create table if not exists hms_announcements (
  id          uuid default uuid_generate_v4() primary key,
  hostel_id   uuid references hms_hostels(id) on delete cascade not null,
  title       text not null,
  content     text not null,
  is_pinned   boolean default false not null,
  created_at  timestamptz default now() not null,
  updated_at  timestamptz default now() not null
);

alter table hms_announcements enable row level security;

create policy "Owner manages own announcements"
  on hms_announcements for all
  using (
    exists (
      select 1 from hms_hostels
      where hms_hostels.id = hms_announcements.hostel_id
        and hms_hostels.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from hms_hostels
      where hms_hostels.id = hms_announcements.hostel_id
        and hms_hostels.owner_id = auth.uid()
    )
  );

create trigger hms_announcements_updated_at before update on hms_announcements
  for each row execute procedure hms_set_updated_at();

-- ============================================================
-- INDEXES
-- ============================================================
create index if not exists idx_hms_payments_hostel_month  on hms_payments(hostel_id, for_month);
create index if not exists idx_hms_payments_tenant_month  on hms_payments(tenant_id, for_month);
create index if not exists idx_hms_payments_status        on hms_payments(hostel_id, status);
create index if not exists idx_hms_complaints_hostel_status on hms_complaints(hostel_id, status);
create index if not exists idx_hms_announcements_hostel   on hms_announcements(hostel_id, is_pinned desc, created_at desc);
create index if not exists idx_hms_tenants_waiting        on hms_tenants(hostel_id, is_waiting);
