-- Pause a branch from platform billing without touching the client's use of it.
--
-- Clients sometimes ask for several branches up front and then quietly stop
-- using one. Today lib/invoice-generation.ts counts EVERY hostel an owner has
-- (`monthly_rate * months * branchCount`) with no filter, so the dormant branch
-- keeps being invoiced and the client has to dispute it.
--
-- Deliberately NOT a "disabled" or "archived" flag: the branch stays fully
-- visible and fully usable to the client — tenants, payments, reminders,
-- everything unchanged. The ONLY thing this changes is whether the branch is
-- counted when generating a platform invoice. Anything broader would be a
-- feature the client can see, and this one is ours alone.
--
-- Additive and inert: DEFAULT true means every existing branch keeps billing
-- exactly as it does today, and no invoice amount moves until someone
-- explicitly pauses a branch.

ALTER TABLE public.hms_hostels
  ADD COLUMN IF NOT EXISTS billing_active boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.hms_hostels.billing_active IS
  'Super Admin only. false = excluded from the branch count on new platform invoices. Does NOT affect the client''s access to the branch in any way. Invoices already issued snapshot branch_count and are unaffected.';

-- Drives the branch count on every invoice generation.
CREATE INDEX IF NOT EXISTS hms_hostels_owner_billing_active_idx
  ON public.hms_hostels (owner_id)
  WHERE billing_active;

-- No RLS change. hms_hostels' existing policies already let an owner read their
-- own rows, so a client could read this column — but it is meaningless to them
-- and nothing in the client UI selects or renders it. Adding a column-level
-- REVOKE here would be theatre: migration 155 established that a column REVOKE
-- is a no-op while a table-wide GRANT exists, which it does.
--
-- Writes are safe by construction: the toggle lives in a server action behind
-- requireSuperAdmin(), and clients have no write path to hms_hostels that
-- includes this column.
