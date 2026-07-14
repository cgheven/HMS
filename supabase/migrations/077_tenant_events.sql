-- 077: Tenant event log — captures room changes, plan changes, and deposit
-- collection/return so the Member Ledger can show a full per-tenant history.
-- hms_tenants.room_id / package_tier are overwritten in place on edit with no
-- history kept, so this table exists specifically to start capturing changes
-- going forward (past changes remain unrecoverable).

create table if not exists hms_tenant_events (
  id          uuid default gen_random_uuid() primary key,
  hostel_id   uuid references hms_hostels(id) on delete cascade not null,
  tenant_id   uuid references hms_tenants(id) on delete cascade not null,
  event_type  text check (event_type in ('room_changed', 'plan_changed', 'deposit_collected', 'deposit_returned', 'deposit_forfeited')) not null,
  from_value  text,
  to_value    text,
  amount      numeric(10,2),
  notes       text,
  created_at  timestamptz default now() not null
);

alter table hms_tenant_events enable row level security;

create policy "Owner manages own tenant events"
  on hms_tenant_events for all
  using (
    exists (
      select 1 from hms_hostels h
      where h.id = hostel_id
        and h.owner_id = auth.uid()
    )
    or exists (
      select 1 from hms_owner_hostels oh
      where oh.hostel_id = hostel_id
        and oh.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from hms_hostels h
      where h.id = hostel_id
        and h.owner_id = auth.uid()
    )
    or exists (
      select 1 from hms_owner_hostels oh
      where oh.hostel_id = hostel_id
        and oh.owner_id = auth.uid()
    )
  );

create index if not exists idx_hms_tenant_events_tenant on hms_tenant_events(tenant_id, created_at);
create index if not exists idx_hms_tenant_events_hostel on hms_tenant_events(hostel_id, created_at);
