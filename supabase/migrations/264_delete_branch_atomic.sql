-- Migration 264: atomic branch deletion.
--
-- Self-service branch deletion (app/actions/branches.ts confirmBranchDeletion)
-- must not do its mutations in separate round trips: if the DELETE fails after
-- residents were already deactivated, the branch survives with everyone checked
-- out and no rollback. This function does the whole teardown in ONE transaction:
--
--   1. Deactivate active residents — the room-delete guard (migration 254) blocks
--      deleting a room that still has an active resident, and it fires during the
--      hostel cascade. The owner has confirmed the whole branch goes.
--   2. Detach CRM leads — hms_platform_leads.converted_hostel_id is a NO ACTION FK, so a
--      converted lead pointing at this branch would otherwise block the delete.
--      Every other child FK is ON DELETE CASCADE (rooms/residents/payments/...).
--   3. Drop the junction row + the hostel (cascade removes everything else).
--
-- If any step fails the whole function rolls back — no half-deleted branch. The
-- Paddle tier reconcile stays in TS (it isn't a DB op) and is idempotent.
-- SECURITY DEFINER + locked search_path: it is called only by the service-role
-- admin client from the server action, after that action has verified ownership
-- and the not-last-branch guard under the per-owner billing lock.

CREATE OR REPLACE FUNCTION public.hms_delete_branch_atomic(p_hostel_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.hms_tenants SET is_active = false
   WHERE hostel_id = p_hostel_id AND is_active;

  UPDATE public.hms_platform_leads SET converted_hostel_id = NULL
   WHERE converted_hostel_id = p_hostel_id;

  DELETE FROM public.hms_owner_hostels WHERE hostel_id = p_hostel_id;
  DELETE FROM public.hms_hostels       WHERE id = p_hostel_id;
END;
$$;
