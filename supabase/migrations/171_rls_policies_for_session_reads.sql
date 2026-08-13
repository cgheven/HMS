-- Restores two reads that migration 170 broke.
--
-- 170 enabled RLS on three tables to close an anon-key data leak. That was
-- right, but "nothing reads these outside createAdminClient()" was wrong: a
-- file-level grep saw createAdminClient somewhere in the file and missed that
-- two call sites use the SESSION client, which RLS does apply to.
--
--   lib/data.ts:1007            hms_whatsapp_messages
--     The WhatsApp delivery tick on every row of the Tenants page.
--   app/actions/tenants.ts:434  hms_room_ac_checkout_readings
--     The checkout meter reading that feeds AC billing at checkout.
--
-- With RLS on and NO policy, both returned zero rows for every owner. The tick
-- silently vanished and the checkout reading silently became null — neither
-- errors, which is what makes this the dangerous kind of breakage.
--
-- Policies rather than switching those call sites to the admin client: every
-- sibling table read the same way from lib/data.ts (hms_payments,
-- hms_tenant_events) is scoped by RLS, and moving reads to service_role would
-- drop a layer the rest of the schema still relies on.
--
-- SELECT only. Every write to these tables already goes through
-- createAdminClient(), which bypasses RLS, so granting write access here would
-- widen the surface for no caller.
--
-- anon stays blocked: auth.uid() is null for it, so both EXISTS clauses are
-- false and hms_partner_hostel_ids() returns nothing. The leak 170 closed does
-- not reopen — verified after applying.
--
-- Rows with a null hostel_id (lead marketing, client invoices) match no policy
-- and stay invisible to owners. Correct: those are Pulse's own messages, and
-- the Super Admin pages that show them use the admin client.

-- ── hms_whatsapp_messages ────────────────────────────────────────────────────
drop policy if exists "Owner reads own whatsapp messages" on public.hms_whatsapp_messages;
create policy "Owner reads own whatsapp messages"
  on public.hms_whatsapp_messages for select
  using (
    exists (
      select 1 from public.hms_hostels h
       where h.id = hms_whatsapp_messages.hostel_id and h.owner_id = auth.uid()
    )
    or exists (
      select 1 from public.hms_owner_hostels oh
       where oh.hostel_id = hms_whatsapp_messages.hostel_id and oh.owner_id = auth.uid()
    )
  );

drop policy if exists "members_read_whatsapp_messages" on public.hms_whatsapp_messages;
create policy "members_read_whatsapp_messages"
  on public.hms_whatsapp_messages for select
  using (hostel_id in (select public.hms_partner_hostel_ids()));

-- ── hms_room_ac_checkout_readings ────────────────────────────────────────────
drop policy if exists "Owner reads own ac checkout readings" on public.hms_room_ac_checkout_readings;
create policy "Owner reads own ac checkout readings"
  on public.hms_room_ac_checkout_readings for select
  using (
    exists (
      select 1 from public.hms_hostels h
       where h.id = hms_room_ac_checkout_readings.hostel_id and h.owner_id = auth.uid()
    )
    or exists (
      select 1 from public.hms_owner_hostels oh
       where oh.hostel_id = hms_room_ac_checkout_readings.hostel_id and oh.owner_id = auth.uid()
    )
  );

drop policy if exists "members_read_ac_checkout_readings" on public.hms_room_ac_checkout_readings;
create policy "members_read_ac_checkout_readings"
  on public.hms_room_ac_checkout_readings for select
  using (hostel_id in (select public.hms_partner_hostel_ids()));

-- hms_inquiries deliberately gets NO policy: demo-request.ts is its only
-- reader/writer and uses the admin client. RLS-on-no-policy is the correct
-- end state there.
