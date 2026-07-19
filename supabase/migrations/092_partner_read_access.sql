-- Lets a partner read the branch(es) they're linked to via hms_partnerships,
-- through the SAME session-scoped (RLS-enforced) queries the owner dashboard
-- already uses in lib/data.ts — additive SELECT-only policies, the existing
-- "Owner manages own X" FOR ALL policies are untouched. Mirrors the exact
-- pattern already used for hms_room_ac_readings/hms_room_ac_join_readings in
-- 045_ac_billing_fixes.sql / 046_ac_join_readings.sql.
--
-- No write policies: writes to these tables always go through server actions
-- using the service-role admin client (bypasses RLS entirely), gated by the
-- application-level requireOwnerOrPartnerTier() guard instead.

create policy "members_read_hostels" on hms_hostels for select using (
  id in (select hostel_id from hms_partnerships where partner_id = auth.uid() and is_active = true)
);

create policy "members_read_rooms" on hms_rooms for select using (
  hostel_id in (select hostel_id from hms_partnerships where partner_id = auth.uid() and is_active = true)
);

create policy "members_read_tenants" on hms_tenants for select using (
  hostel_id in (select hostel_id from hms_partnerships where partner_id = auth.uid() and is_active = true)
);

create policy "members_read_payments" on hms_payments for select using (
  hostel_id in (select hostel_id from hms_partnerships where partner_id = auth.uid() and is_active = true)
);

create policy "members_read_expenses" on hms_expenses for select using (
  hostel_id in (select hostel_id from hms_partnerships where partner_id = auth.uid() and is_active = true)
);

create policy "members_read_kitchen_expenses" on hms_kitchen_expenses for select using (
  hostel_id in (select hostel_id from hms_partnerships where partner_id = auth.uid() and is_active = true)
);

create policy "members_read_bills" on hms_bills for select using (
  hostel_id in (select hostel_id from hms_partnerships where partner_id = auth.uid() and is_active = true)
);

create policy "members_read_salary_payments" on hms_salary_payments for select using (
  hostel_id in (select hostel_id from hms_partnerships where partner_id = auth.uid() and is_active = true)
);
