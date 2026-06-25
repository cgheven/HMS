-- Migration 037: Fix audit log INSERT policy
-- The service role bypasses RLS and never needed an INSERT policy.
-- The existing "with check (true)" policy allowed any session (anon or authenticated)
-- to POST arbitrary rows to hms_audit_log, enabling audit record forgery.

DROP POLICY IF EXISTS "Service role inserts audit log" ON hms_audit_log;

-- Revoke direct INSERT from anon and authenticated roles.
-- Only the service-role admin client (writeAuditLog server action) can write records.
REVOKE INSERT ON hms_audit_log FROM anon, authenticated;
