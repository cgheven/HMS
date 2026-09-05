-- Room transfer: mark a closing reading as a MOVE rather than a departure.
--
-- A tenant moving between rooms mid-month needs the same two breakpoints a real
-- checkout and a real admission already produce: a closing reading on the room
-- they left, and an opening reading on the room they joined. Both tables already
-- exist and the billing engine already consumes both — hms_room_ac_checkout_readings
-- for the departure side, hms_room_ac_join_readings for the arrival side.
--
-- The one thing the engine cannot infer is WHY the closing reading exists:
--   * a real checkout settles the tenant's share at the door and the tenant goes
--     inactive, so nothing may ever add to their bill again;
--   * a transfer leaves the tenant active in a different room, and their share of
--     the room they left has to survive the NEW room's month-end Apply, which
--     overwrites ac_charge outright.
--
-- is_active cannot carry that distinction: a tenant may transfer on the 10th and
-- check out for real on the 25th, and the transfer row would then read as a
-- checkout. So the reason is stored explicitly.
--
-- Additive and nullable — every existing row is a real checkout and stays one.

alter table public.hms_room_ac_checkout_readings
  add column if not exists transferred_to_room_id uuid
  references public.hms_rooms(id) on delete set null;

comment on column public.hms_room_ac_checkout_readings.transferred_to_room_id is
  'NULL = this reading closed the tenant''s stay because they LEFT the hostel (their AC share was settled at checkout). Set = they MOVED to this room in the same hostel; the tenant is still active and this room''s share is added to their bill by whichever room they are in at month end.';

-- The lookup the Apply and checkout paths make per tenant per month: "what does
-- this tenant owe from rooms they have already moved out of this month?"
create index if not exists hms_room_ac_checkout_readings_transfer_idx
  on public.hms_room_ac_checkout_readings (hostel_id, for_month, tenant_id)
  where transferred_to_room_id is not null;
