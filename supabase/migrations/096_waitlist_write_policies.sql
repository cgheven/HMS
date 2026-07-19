-- Waitlist write policies.
--
-- hms_waitlist shipped in 020 with exactly two policies: "Anyone can join
-- waitlist" (INSERT, public) and "Owner reads own waitlist" (SELECT). There has
-- never been a DELETE or UPDATE policy, so the Remove button on the Tenants
-- page has been a no-op for EVERY user since 020 — including owners. RLS denies
-- the DELETE by matching zero rows, which Postgres does not report as an error,
-- so the client saw `error === null`, dropped the row from local state, and the
-- entry reappeared on the next load. This migration is the first time waitlist
-- deletion works at all; it is not solely a partner fix.
--
-- Reads: the Tenants page fetches the waitlist server-side with the admin
-- client (app/(dashboard)/tenants/page.tsx), which bypasses RLS, so partners
-- already see entries there. Settings reads it with the anon client, which
-- returned empty for partners — the SELECT policy below closes that.
--
-- Tier: waitlist entries are inbound tenant-pipeline leads, i.e. day-to-day
-- work, so writes are standard + full via hms_partner_write_hostel_ids().
-- read_only partners get SELECT only. INSERT deliberately keeps its public
-- policy — that is the public listing's "join waitlist" form, guarded by
-- rate-limiting and dedup in app/actions/public.ts.
--
-- ANTI-RECURSION (the 092 outage): the partner predicates route through the
-- STABLE SECURITY DEFINER helpers from 093/094, never an inline
-- `select ... from hms_partnerships` subquery. The inline form on hms_hostels
-- in 092 cycled through hms_partnerships' own policy and took every owner's
-- hostel access down.
--
-- Every policy here is ADDITIVE. Nothing from 020 is dropped or altered.

-- Owners: mirror the existing "Owner reads own waitlist" predicate for the
-- write verbs it never covered.
drop policy if exists "Owner manages own waitlist" on hms_waitlist;
create policy "Owner manages own waitlist"
  on hms_waitlist for delete
  using (
    exists (
      select 1 from hms_hostels
      where hms_hostels.id = hms_waitlist.hostel_id
        and hms_hostels.owner_id = auth.uid()
    )
  );

drop policy if exists "Owner updates own waitlist" on hms_waitlist;
create policy "Owner updates own waitlist"
  on hms_waitlist for update
  using (
    exists (
      select 1 from hms_hostels
      where hms_hostels.id = hms_waitlist.hostel_id
        and hms_hostels.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from hms_hostels
      where hms_hostels.id = hms_waitlist.hostel_id
        and hms_hostels.owner_id = auth.uid()
    )
  );

-- Partners: read at any active tier, write at standard + full.
drop policy if exists "members_read_waitlist" on hms_waitlist;
create policy "members_read_waitlist" on hms_waitlist for select using (
  hostel_id in (select hms_partner_hostel_ids())
);

drop policy if exists "members_delete_waitlist" on hms_waitlist;
create policy "members_delete_waitlist" on hms_waitlist for delete using (
  hostel_id in (select hms_partner_write_hostel_ids())
);

drop policy if exists "members_update_waitlist" on hms_waitlist;
create policy "members_update_waitlist" on hms_waitlist for update
  using      (hostel_id in (select hms_partner_write_hostel_ids()))
  with check (hostel_id in (select hms_partner_write_hostel_ids()));
