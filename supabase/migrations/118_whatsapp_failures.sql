-- Log every WhatsApp send failure (Meta API migration) — enough context to
-- diagnose without digging through server logs. Ops log, admin-only
-- visibility, no self-serve owner UI — mirrors hms_activity_log's RLS shape
-- (migration 088), not the owner-facing "Owner manages own X" join pattern.
create table hms_whatsapp_failures (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid references hms_hostels(id) on delete set null,
  tenant_id uuid references hms_tenants(id) on delete set null,
  phone text not null,
  message_type text not null check (message_type in ('reminder','announcement','welcome','leaving_reminder','test')),
  error text,
  created_at timestamptz not null default now()
);

create index idx_hms_whatsapp_failures_hostel on hms_whatsapp_failures(hostel_id, created_at desc);

alter table hms_whatsapp_failures enable row level security;
revoke insert, update, delete on hms_whatsapp_failures from anon, authenticated;

create policy "admins read whatsapp failures" on hms_whatsapp_failures
  for select using (hms_is_admin());
