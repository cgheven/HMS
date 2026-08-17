-- Metering is not the same fact as "this room has an air conditioner".
--
-- hms_rooms.has_ac has been carrying two unrelated jobs:
--   1. A PHYSICAL FACT — shown as an amenity on the public listing, and used by
--      lib/room-pricing.ts to pick the AC vs non-AC seater price and deposit.
--   2. A BILLING RULE — the only thing that lets a room be metered at all
--      (app/actions/payments.ts throws "This room does not have AC").
--
-- For most branches those coincide. For a branch that bills electricity per room
-- they do not: EVERY room is metered, and only some have AC. The workaround —
-- ticking has_ac on every room — advertises air conditioning that is not there
-- and silently moves every room onto the AC price list.
--
-- This column separates the two. When true, any room on the branch may be
-- metered; has_ac stays truthful and keeps driving the listing, the pricing and
-- the AC-maintenance charge exactly as before.
--
-- DEFAULT FALSE and no backfill: every existing branch behaves identically until
-- somebody deliberately turns it on. It widens what is permitted and changes no
-- price, no stored reading, and no bill that already exists.
alter table public.hms_hostels
  add column if not exists meter_all_rooms boolean not null default false;

comment on column public.hms_hostels.meter_all_rooms is
  'When true, every room on this branch can be metered for units regardless of has_ac — for branches that bill electricity per room. has_ac remains the physical fact used by the public listing and by seater pricing.';
