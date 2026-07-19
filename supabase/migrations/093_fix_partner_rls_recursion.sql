-- Migration 092 introduced infinite RLS recursion: the new hms_hostels policy
-- queries hms_partnerships, and hms_partnerships' own pre-existing policy
-- ("Hostel owner can manage partnerships") queries hms_hostels back — a
-- 2-table cycle that broke ALL hms_hostels reads for every owner, not just
-- partners (confirmed via a direct impersonated-role query: "infinite
-- recursion detected in policy for relation hms_hostels").
--
-- Fix: route the hms_partnerships lookup through a STABLE SECURITY DEFINER
-- function, the exact same pattern this codebase already uses to break this
-- class of recursion (see hms_is_super_admin()). A SECURITY DEFINER function
-- runs with the privileges of its owner, so its internal query against
-- hms_partnerships does not re-trigger hms_partnerships' own RLS policy,
-- breaking the cycle at its source.

create or replace function public.hms_partner_hostel_ids()
returns setof uuid
language sql
stable security definer
set search_path to 'public'
as $$
  select hostel_id from hms_partnerships where partner_id = auth.uid() and is_active = true
$$;

drop policy if exists "members_read_hostels" on hms_hostels;
create policy "members_read_hostels" on hms_hostels for select using (
  id in (select hms_partner_hostel_ids())
);

drop policy if exists "members_read_rooms" on hms_rooms;
create policy "members_read_rooms" on hms_rooms for select using (
  hostel_id in (select hms_partner_hostel_ids())
);

drop policy if exists "members_read_tenants" on hms_tenants;
create policy "members_read_tenants" on hms_tenants for select using (
  hostel_id in (select hms_partner_hostel_ids())
);

drop policy if exists "members_read_payments" on hms_payments;
create policy "members_read_payments" on hms_payments for select using (
  hostel_id in (select hms_partner_hostel_ids())
);

drop policy if exists "members_read_expenses" on hms_expenses;
create policy "members_read_expenses" on hms_expenses for select using (
  hostel_id in (select hms_partner_hostel_ids())
);

drop policy if exists "members_read_kitchen_expenses" on hms_kitchen_expenses;
create policy "members_read_kitchen_expenses" on hms_kitchen_expenses for select using (
  hostel_id in (select hms_partner_hostel_ids())
);

drop policy if exists "members_read_bills" on hms_bills;
create policy "members_read_bills" on hms_bills for select using (
  hostel_id in (select hms_partner_hostel_ids())
);

drop policy if exists "members_read_salary_payments" on hms_salary_payments;
create policy "members_read_salary_payments" on hms_salary_payments for select using (
  hostel_id in (select hms_partner_hostel_ids())
);
