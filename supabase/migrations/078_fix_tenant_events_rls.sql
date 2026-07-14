-- 078: Fix column-shadowing bug in hms_tenant_events RLS policy (077).
-- The junction-table EXISTS clause used an unqualified `hostel_id`, which
-- Postgres resolved to hms_owner_hostels.hostel_id (its own column) instead
-- of the outer hms_tenant_events.hostel_id — making that branch of the OR
-- always true for any owner with at least one hms_owner_hostels row.
-- Not currently exploitable (all app writes/reads use the service-role admin
-- client, which bypasses RLS), but the policy itself was broken and must be
-- corrected before anything ever queries this table with the anon/user client.

drop policy if exists "Owner manages own tenant events" on hms_tenant_events;

create policy "Owner manages own tenant events"
  on hms_tenant_events for all
  using (
    exists (
      select 1 from hms_hostels h
      where h.id = hms_tenant_events.hostel_id
        and h.owner_id = auth.uid()
    )
    or exists (
      select 1 from hms_owner_hostels oh
      where oh.hostel_id = hms_tenant_events.hostel_id
        and oh.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from hms_hostels h
      where h.id = hms_tenant_events.hostel_id
        and h.owner_id = auth.uid()
    )
    or exists (
      select 1 from hms_owner_hostels oh
      where oh.hostel_id = hms_tenant_events.hostel_id
        and oh.owner_id = auth.uid()
    )
  );
