-- ROOM OCCUPANCY INTEGRITY — make hms_rooms.occupied and .status DB-authoritative,
-- and enforce capacity, so the counter can never drift again and rooms can't be
-- over-filled by ANY code path (server or the browser client path).
--
-- Root cause being fixed: `occupied` was a denormalized counter maintained by hand
-- in ~12 code paths (owner client-side, manager, partner, applications, checkout,
-- delete, transfer) as non-atomic `occupied ± 1`. Some paths miss the increment
-- (under-count), some miss the decrement on delete/reassign (phantom over-count),
-- and nothing bounded it to capacity. Downstream (Spaces occupancy, the tenant-form
-- "N free" dropdown, dashboards) trusts this drifted number.
--
-- The fix has three parts, all additive and idempotent:
--   1. hms_sync_room_occupancy()  — AFTER trigger: recompute occupied+status from the
--      LIVE active-tenant count on every tenant insert/update/delete/room-change.
--      This makes the column self-healing across every path, present and future.
--   2. hms_enforce_room_capacity() — BEFORE trigger: block a tenant ENTERING a room
--      that is already full. Existing over-capacity rooms are GRANDFATHERED (their
--      current occupants and edits are untouched); only a NEW entrant beyond capacity
--      is refused. Applies to all hostels — over-capacity is a bug everywhere.
--   3. One-time reconcile of every room to the truth (heals the rows that drifted).
--
-- NB: `occupied` stays a stored column (every read site is unchanged — low blast
-- radius); the trigger just keeps it correct. A companion code change removes the
-- now-redundant app-side ± 1 writes so they cannot clobber the trigger's value.

-- Bound how long the one-time reconcile UPDATE will wait on a row lock, so this
-- migration can never stall live writes on hms_rooms (matches migrations 229-231).
SET lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Sync trigger — occupied + status always equal the live active-tenant count.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hms_sync_room_occupancy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rid uuid;
BEGIN
  -- Recompute every room this write could have affected: the room left (OLD) and
  -- the room joined (NEW). On INSERT there is no OLD; on DELETE there is no NEW.
  FOR rid IN
    SELECT DISTINCT v FROM (VALUES
      (CASE WHEN TG_OP <> 'INSERT' THEN OLD.room_id END),
      (CASE WHEN TG_OP <> 'DELETE' THEN NEW.room_id END)
    ) AS t(v)
    WHERE v IS NOT NULL
  LOOP
    UPDATE public.hms_rooms rm
    SET occupied = sub.cnt,
        status = CASE
                   WHEN rm.status = 'maintenance' THEN 'maintenance'   -- never auto-clear a manual maintenance hold
                   WHEN COALESCE(rm.capacity, 0) > 0 AND sub.cnt >= rm.capacity THEN 'occupied'
                   ELSE 'available'
                 END
    FROM (
      SELECT count(*)::int AS cnt
      FROM public.hms_tenants t
      WHERE t.room_id = rid AND t.is_active
    ) sub
    WHERE rm.id = rid
      -- Skip the write entirely when nothing changes, so this trigger never
      -- needlessly bumps updated_at or trips the hms_rooms frozen-guard.
      AND (rm.occupied IS DISTINCT FROM sub.cnt
           OR rm.status IS DISTINCT FROM (CASE
                   WHEN rm.status = 'maintenance' THEN 'maintenance'
                   WHEN COALESCE(rm.capacity, 0) > 0 AND sub.cnt >= rm.capacity THEN 'occupied'
                   ELSE 'available' END));
  END LOOP;
  RETURN NULL; -- AFTER trigger
END;
$$;

DROP TRIGGER IF EXISTS hms_tenants_sync_room_occupancy ON public.hms_tenants;
CREATE TRIGGER hms_tenants_sync_room_occupancy
  AFTER INSERT OR UPDATE OF room_id, is_active OR DELETE ON public.hms_tenants
  FOR EACH ROW EXECUTE FUNCTION public.hms_sync_room_occupancy();

-- ---------------------------------------------------------------------------
-- 2. Capacity guard — a tenant cannot ENTER a room that is already full.
--    Grandfathers existing over-capacity rooms: fires only on a NEW occupancy
--    (insert active, reactivation, or a room change INTO the target), and counts
--    only OTHER active tenants, so editing/removing the current occupants of an
--    already-over-filled room still works.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hms_enforce_room_capacity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cap    int;
  others int;
BEGIN
  -- Only relevant when the tenant will be ACTIVE in a room.
  IF NEW.is_active IS NOT TRUE OR NEW.room_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- On UPDATE, skip when this is NOT a new occupancy of NEW.room_id — i.e. the
  -- tenant was already active in this same room (a plain edit). That grandfathers
  -- the current occupants of an over-filled room.
  IF TG_OP = 'UPDATE'
     AND NEW.room_id IS NOT DISTINCT FROM OLD.room_id
     AND OLD.is_active IS TRUE THEN
    RETURN NEW;
  END IF;

  -- Lock the room row so concurrent admits into the same room SERIALIZE: without
  -- this, two transactions racing for the last bed each count(*) without seeing the
  -- other's uncommitted row and both pass. FOR UPDATE makes the second wait for the
  -- first to commit, then its count sees that row and correctly refuses. A capacity
  -- EDIT (which already row-locks the room) serializes against admits the same way.
  SELECT capacity INTO cap FROM public.hms_rooms WHERE id = NEW.room_id FOR UPDATE;
  IF cap IS NULL THEN
    RETURN NEW; -- no capacity set → nothing to enforce
  END IF;

  SELECT count(*) INTO others
  FROM public.hms_tenants t
  WHERE t.room_id = NEW.room_id AND t.is_active AND t.id <> NEW.id;

  IF others >= cap THEN
    RAISE EXCEPTION 'Room is at full capacity (% of % beds occupied). Free a bed or increase the room''s capacity before assigning another resident.',
      others, cap
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS hms_tenants_enforce_room_capacity ON public.hms_tenants;
CREATE TRIGGER hms_tenants_enforce_room_capacity
  BEFORE INSERT OR UPDATE OF room_id, is_active ON public.hms_tenants
  FOR EACH ROW EXECUTE FUNCTION public.hms_enforce_room_capacity();

-- ---------------------------------------------------------------------------
-- 2b. Capacity-edit guard — a room's capacity cannot be LOWERED below the number
--     of residents already living in it. Without this, the other guard (which only
--     stops tenants ENTERING a full room) is bypassable: raise capacity, admit,
--     then shrink capacity back down and the room is over-filled again. Grandfathers
--     an existing over-capacity room — editing it without lowering capacity, or
--     raising it, is always allowed; only a genuine lower-below-occupancy is refused.
--     Also keeps occupied/status consistent the instant capacity changes (the tenant
--     sync trigger never fires on an hms_rooms-only edit).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hms_guard_room_capacity_edit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  active int;
BEGIN
  IF NEW.capacity IS DISTINCT FROM OLD.capacity THEN
    SELECT count(*) INTO active FROM public.hms_tenants t
      WHERE t.room_id = NEW.id AND t.is_active;

    IF NEW.capacity < active AND NEW.capacity < OLD.capacity THEN
      RAISE EXCEPTION 'Cannot set capacity to % — the room has % active resident(s). Move or check out residents first.',
        NEW.capacity, active
        USING ERRCODE = 'check_violation';
    END IF;

    -- Keep occupied/status truthful the moment capacity changes.
    NEW.occupied := active;
    NEW.status := CASE
                    WHEN NEW.status = 'maintenance' THEN 'maintenance'
                    WHEN COALESCE(NEW.capacity, 0) > 0 AND active >= NEW.capacity THEN 'occupied'
                    ELSE 'available'
                  END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS hms_rooms_guard_capacity_edit ON public.hms_rooms;
CREATE TRIGGER hms_rooms_guard_capacity_edit
  BEFORE UPDATE OF capacity ON public.hms_rooms
  FOR EACH ROW EXECUTE FUNCTION public.hms_guard_room_capacity_edit();

-- ---------------------------------------------------------------------------
-- 2c. Delete guard — a room with active residents cannot be deleted. The FK
--     hms_tenants.room_id is ON DELETE SET NULL, so deleting an occupied room
--     silently ORPHANS its residents (active, room_id NULL). Block it, mirroring
--     the super-admin deleteHostel guard. Safe against the hostel-delete cascade:
--     deleteHostel already refuses while active tenants exist, so by the time its
--     cascade drops the rooms there are none, and this guard passes.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hms_guard_room_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  active int;
BEGIN
  SELECT count(*) INTO active FROM public.hms_tenants t
    WHERE t.room_id = OLD.id AND t.is_active;
  IF active > 0 THEN
    RAISE EXCEPTION 'Cannot delete this room — it has % active resident(s). Move or check them out first.', active
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS hms_rooms_guard_delete ON public.hms_rooms;
CREATE TRIGGER hms_rooms_guard_delete
  BEFORE DELETE ON public.hms_rooms
  FOR EACH ROW EXECUTE FUNCTION public.hms_guard_room_delete();

-- ---------------------------------------------------------------------------
-- 3. One-time reconcile — heal every drifted room to the live truth.
-- ---------------------------------------------------------------------------
UPDATE public.hms_rooms rm
SET occupied = sub.cnt,
    status = CASE
               WHEN rm.status = 'maintenance' THEN 'maintenance'
               WHEN COALESCE(rm.capacity, 0) > 0 AND sub.cnt >= rm.capacity THEN 'occupied'
               ELSE 'available'
             END
FROM (
  SELECT r.id, count(t.*) FILTER (WHERE t.is_active) AS cnt
  FROM public.hms_rooms r
  LEFT JOIN public.hms_tenants t ON t.room_id = r.id
  GROUP BY r.id
) sub
WHERE rm.id = sub.id
  AND (rm.occupied IS DISTINCT FROM sub.cnt
       OR rm.status IS DISTINCT FROM (CASE
               WHEN rm.status = 'maintenance' THEN 'maintenance'
               WHEN COALESCE(rm.capacity, 0) > 0 AND sub.cnt >= rm.capacity THEN 'occupied'
               ELSE 'available' END));
