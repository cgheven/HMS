-- Migration 268: lock down the atomic branch-delete RPC (SECURITY hotfix).
--
-- migration 264 created public.hms_delete_branch_atomic(uuid) as SECURITY DEFINER
-- but — unlike every other service-role-only definer function in this project
-- (hms_freeze_overdue_accounts 232, hms_freeze_expired_trials 241,
-- hms_submit_tenant_feedback 161) — it never REVOKEd EXECUTE. Under Supabase's
-- default privileges, EXECUTE on a public function is granted to anon +
-- authenticated, so ANY signed-in (or anonymous) user could call it via PostgREST
-- with an arbitrary p_hostel_id and cascade-delete another tenant's entire branch.
--
-- It must be callable ONLY by the service-role admin client (from
-- confirmBranchDeletion / removeSampleData, which verify ownership first).
-- Applied live to prod + stage the moment it was found; this file is the repo
-- record so a rebuild/replay stays safe.

REVOKE ALL ON FUNCTION public.hms_delete_branch_atomic(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hms_delete_branch_atomic(uuid) TO service_role;
