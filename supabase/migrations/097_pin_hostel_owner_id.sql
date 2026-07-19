-- Pin hms_hostels.owner_id against modification by any end user.
--
-- Migration 094 added members_update_hostels so a full-tier partner can edit
-- their branch's settings (name, listing, form config). That policy constrains
-- only `id`, in both USING and WITH CHECK. Postgres RLS has NO column-level
-- granularity — a policy either permits the UPDATE or it does not — so every
-- other column, including owner_id, was freely writable.
--
-- Verified exploitable against production before writing this fix. As a
-- full-tier partner, in one rolled-back transaction:
--     update hms_hostels set owner_id = <partner_uid> where id = <their branch>;
--       -> 1 row. owner_id now points at the attacker.
--     delete from hms_hostels where id = <their branch>;
--       -> 1 row. The whole branch, with every tenant and payment, cascades.
-- The second step succeeds because rewriting owner_id makes the attacker match
-- 001's "Owner manages own hostel" FOR ALL policy — which grants DELETE, in
-- direct contradiction of 094's own comment that a partner must never be able
-- to delete a branch. It also permanently locks out the real owner: neither
-- hms_hostels SELECT policy admits someone who is no longer owner_id and has no
-- partnership row, so the branch simply disappears from their dashboard.
--
-- RLS cannot express "every column except this one", so the guard is a trigger,
-- mirroring hms_prevent_role_self_escalation() from 024_security_fixes.sql —
-- the same shape already used to stop role self-escalation on hms_profiles.
--
-- auth.uid() is NULL under the service role, so createAdminClient() calls are
-- deliberately exempt: super-admin branch provisioning and any future
-- ownership-transfer tooling keep working. No application code currently
-- UPDATEs owner_id at all (every write in app/actions/** is an INSERT), so this
-- is a no-op for every existing legitimate path, including
-- app/actions/settings.ts and the Settings page's own hostel update.

CREATE OR REPLACE FUNCTION hms_prevent_hostel_owner_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id AND auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Forbidden: hostel ownership cannot be transferred';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS hms_block_hostel_owner_change ON hms_hostels;

CREATE TRIGGER hms_block_hostel_owner_change
  BEFORE UPDATE ON hms_hostels
  FOR EACH ROW
  EXECUTE FUNCTION hms_prevent_hostel_owner_change();
