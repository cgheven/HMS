-- Partner branch parity.
--
-- Partners previously reached only Dashboard/Tenants/Payments/Reports. They now
-- reach every branch-scoped page an owner does (Spaces, Expenses, Kitchen, Food
-- List, Bills, Staff, Complaints, Announcements, Settings), because a partner is
-- an owner of that branch. Managers, Billing, the Settings > Branches card and
-- the Settings > Partners card stay owner-only: those write hms_profiles /
-- hms_partnerships / hms_client_billing, i.e. the ACCOUNT's identity and
-- subscription, not branch data. Letting a partner touch them would let them
-- re-tier themselves, add partners, or remove the owner.
--
-- Those eight pages write directly from the browser with the anon client (no
-- server-action layer), so RLS is their only gate — unlike tenants/payments,
-- whose partner writes go through admin-client actions in app/actions/partner.ts.
-- Extending RLS here is therefore the correct mechanism, not a departure from
-- the hybrid architecture: it is how those pages already work for owners.
--
-- ANTI-RECURSION (the 092 outage): every partner predicate below routes through
-- a STABLE SECURITY DEFINER function, never an inline
-- `select ... from hms_partnerships` subquery. Migration 092 used the inline
-- form on hms_hostels; hms_partnerships' own policy queries hms_hostels, which
-- queried back = "infinite recursion detected in policy for relation
-- hms_hostels", and every owner lost access to their hostels. SECURITY DEFINER
-- bypasses hms_partnerships' RLS entirely, so no cycle can form. Migration 093
-- introduced hms_partner_hostel_ids() for exactly this reason.
--
-- Every policy here is ADDITIVE. No existing "Owner manages ..." policy is
-- dropped or altered, so owner behaviour is bit-for-bit unchanged.

-- ---------------------------------------------------------------------------
-- 1. Tier-scoped helpers (siblings of 093's hms_partner_hostel_ids, which
--    stays as the any-tier read predicate).
-- ---------------------------------------------------------------------------

-- Day-to-day operations: standard and full.
create or replace function public.hms_partner_write_hostel_ids()
returns setof uuid
language sql
stable security definer
set search_path to 'public'
as $$
  select hostel_id from hms_partnerships
  where partner_id = auth.uid()
    and is_active = true
    and tier in ('standard', 'full')
$$;

-- Structural / pricing / payroll: full only — the tier defined as "equal to the
-- owner on this branch".
create or replace function public.hms_partner_full_hostel_ids()
returns setof uuid
language sql
stable security definer
set search_path to 'public'
as $$
  select hostel_id from hms_partnerships
  where partner_id = auth.uid()
    and is_active = true
    and tier = 'full'
$$;

revoke all on function public.hms_partner_write_hostel_ids() from public;
revoke all on function public.hms_partner_full_hostel_ids()  from public;
grant execute on function public.hms_partner_write_hostel_ids() to authenticated;
grant execute on function public.hms_partner_full_hostel_ids()  to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Missing SELECT policies — any active tier, including read_only.
--    These five tables had no partner read at all, so the pages that read them
--    rendered empty. hms_package_configs is the notable one: it is read by
--    getTenants()/getPaymentsPageData(), so without this a partner silently got
--    zeroed food add-on rates and a defaulted 30-day notice period on pages
--    they already had access to.
-- ---------------------------------------------------------------------------

drop policy if exists "members_read_food_items" on hms_food_items;
create policy "members_read_food_items" on hms_food_items for select using (
  hostel_id in (select hms_partner_hostel_ids())
);

drop policy if exists "members_read_employees" on hms_employees;
create policy "members_read_employees" on hms_employees for select using (
  hostel_id in (select hms_partner_hostel_ids())
);

drop policy if exists "members_read_complaints" on hms_complaints;
create policy "members_read_complaints" on hms_complaints for select using (
  hostel_id in (select hms_partner_hostel_ids())
);

drop policy if exists "members_read_announcements" on hms_announcements;
create policy "members_read_announcements" on hms_announcements for select using (
  hostel_id in (select hms_partner_hostel_ids())
);

drop policy if exists "members_read_package_configs" on hms_package_configs;
create policy "members_read_package_configs" on hms_package_configs for select using (
  hostel_id in (select hms_partner_hostel_ids())
);

-- ---------------------------------------------------------------------------
-- 3. Write policies — standard and full.
--    Day-to-day branch operations. "for all" is safe here: it adds a permissive
--    path that ORs with the existing owner policy and the read policies above,
--    so read_only partners keep SELECT via section 2 and gain nothing here.
-- ---------------------------------------------------------------------------

drop policy if exists "members_write_expenses" on hms_expenses;
create policy "members_write_expenses" on hms_expenses for all
  using      (hostel_id in (select hms_partner_write_hostel_ids()))
  with check (hostel_id in (select hms_partner_write_hostel_ids()));

drop policy if exists "members_write_kitchen_expenses" on hms_kitchen_expenses;
create policy "members_write_kitchen_expenses" on hms_kitchen_expenses for all
  using      (hostel_id in (select hms_partner_write_hostel_ids()))
  with check (hostel_id in (select hms_partner_write_hostel_ids()));

drop policy if exists "members_write_food_items" on hms_food_items;
create policy "members_write_food_items" on hms_food_items for all
  using      (hostel_id in (select hms_partner_write_hostel_ids()))
  with check (hostel_id in (select hms_partner_write_hostel_ids()));

drop policy if exists "members_write_complaints" on hms_complaints;
create policy "members_write_complaints" on hms_complaints for all
  using      (hostel_id in (select hms_partner_write_hostel_ids()))
  with check (hostel_id in (select hms_partner_write_hostel_ids()));

drop policy if exists "members_write_announcements" on hms_announcements;
create policy "members_write_announcements" on hms_announcements for all
  using      (hostel_id in (select hms_partner_write_hostel_ids()))
  with check (hostel_id in (select hms_partner_write_hostel_ids()));

drop policy if exists "members_write_bills" on hms_bills;
create policy "members_write_bills" on hms_bills for all
  using      (hostel_id in (select hms_partner_write_hostel_ids()))
  with check (hostel_id in (select hms_partner_write_hostel_ids()));

-- ---------------------------------------------------------------------------
-- 4. Write policies — full tier only.
--    Room inventory, payroll, and pricing. Same class of restriction already
--    applied to checkout and historical-payment backfill: things that rewrite
--    the branch's structure or settled money, not just today's operations.
-- ---------------------------------------------------------------------------

drop policy if exists "members_write_rooms" on hms_rooms;
create policy "members_write_rooms" on hms_rooms for all
  using      (hostel_id in (select hms_partner_full_hostel_ids()))
  with check (hostel_id in (select hms_partner_full_hostel_ids()));

drop policy if exists "members_write_employees" on hms_employees;
create policy "members_write_employees" on hms_employees for all
  using      (hostel_id in (select hms_partner_full_hostel_ids()))
  with check (hostel_id in (select hms_partner_full_hostel_ids()));

drop policy if exists "members_write_salary_payments" on hms_salary_payments;
create policy "members_write_salary_payments" on hms_salary_payments for all
  using      (hostel_id in (select hms_partner_full_hostel_ids()))
  with check (hostel_id in (select hms_partner_full_hostel_ids()));

drop policy if exists "members_write_package_configs" on hms_package_configs;
create policy "members_write_package_configs" on hms_package_configs for all
  using      (hostel_id in (select hms_partner_full_hostel_ids()))
  with check (hostel_id in (select hms_partner_full_hostel_ids()));

-- hms_hostels: UPDATE only, never "for all" — a partner must never be able to
-- DELETE the branch, and INSERT is how new branches are created (owner-only,
-- also guarded in app code by createBranch's requireOwnerOrAbove).
drop policy if exists "members_update_hostels" on hms_hostels;
create policy "members_update_hostels" on hms_hostels for update
  using      (id in (select hms_partner_full_hostel_ids()))
  with check (id in (select hms_partner_full_hostel_ids()));
