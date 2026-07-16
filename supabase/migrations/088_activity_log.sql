-- Activity log: who did what, when, on which branch — for day-to-day product
-- usage (tenants, kitchen, expenses, staff, complaints, payments, AC, managers).
-- Distinct from hms_audit_log, which is super-admin/CRM actions only.
--
-- Most "add" flows insert directly from the browser via the user's own session
-- (no server action to hang a log call off), but auth.uid() is still visible to
-- Postgres at insert time — so a SECURITY DEFINER trigger captures these
-- automatically, the same technique hms_login_log's hms_log_user_login()
-- trigger already uses.

create table hms_activity_log (
  id         uuid        primary key default gen_random_uuid(),
  hostel_id  uuid        references hms_hostels(id) on delete set null,
  actor_id   uuid,                              -- nullable: user may be deleted later
  action     text        not null,              -- 'tenant.create', 'payment.paid', ...
  entity     text        not null,              -- 'tenant', 'payment', ...
  entity_id  uuid,
  meta       jsonb,                             -- full row snapshot (trigger-sourced) or explicit payload
  created_at timestamptz not null default now()
);

alter table hms_activity_log enable row level security;

create policy "admins read activity log"
  on hms_activity_log for select
  using (hms_is_admin());

-- No insert/update/delete grants to anon/authenticated — writes only via the
-- SECURITY DEFINER trigger below, or the service-role admin client.
revoke insert, update, delete on hms_activity_log from anon, authenticated;

create index idx_hms_activity_log_created  on hms_activity_log (created_at desc);
create index idx_hms_activity_log_hostel   on hms_activity_log (hostel_id);
create index idx_hms_activity_log_actor    on hms_activity_log (actor_id);

-- Generic trigger function: TG_ARGV[0] = action, TG_ARGV[1] = entity.
-- Assumes NEW has a hostel_id column, true for every table it's attached to below.
create or replace function hms_log_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into hms_activity_log (hostel_id, actor_id, action, entity, entity_id, meta)
  values (NEW.hostel_id, auth.uid(), TG_ARGV[0], TG_ARGV[1], NEW.id, to_jsonb(NEW));
  return NEW;
end;
$$;

create trigger trg_log_tenant
  after insert on hms_tenants
  for each row execute function hms_log_activity('tenant.create', 'tenant');

create trigger trg_log_kitchen_expense
  after insert on hms_kitchen_expenses
  for each row execute function hms_log_activity('kitchen_expense.create', 'kitchen_expense');

create trigger trg_log_expense
  after insert on hms_expenses
  for each row execute function hms_log_activity('expense.create', 'expense');

create trigger trg_log_employee
  after insert on hms_employees
  for each row execute function hms_log_activity('employee.create', 'employee');

create trigger trg_log_complaint
  after insert on hms_complaints
  for each row execute function hms_log_activity('complaint.create', 'complaint');
