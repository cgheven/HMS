-- GDPR personal-data audit trail — extend the EXISTING hms_audit_log (migration
-- 017), never a new table. The table already carries deliberate super-admin/CRM
-- actions; this scopes it so an owner can also read the PII-access events for
-- their own branches (document views, edits, deletions) without seeing anyone
-- else's, and without touching the super-admin global view.
--
-- Purely additive and a verified no-op for existing rows: hostel_id is NULLABLE
-- and defaults NULL, so every legacy/super-admin row reads back byte-identical
-- and the existing "Admins read audit log" + "Service role inserts" policies are
-- left exactly as they were. Only a new owner-scoped SELECT policy is ADDED.

ALTER TABLE public.hms_audit_log
  ADD COLUMN IF NOT EXISTS hostel_id uuid REFERENCES public.hms_hostels(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_hms_audit_log_hostel
  ON public.hms_audit_log (hostel_id, created_at DESC);

-- Owners (and their co-owners via the junction) may read audit rows scoped to a
-- branch they own. Legacy rows (hostel_id NULL) match nobody here and stay
-- admin-only, exactly as before. This is additive to the admin policy — RLS
-- SELECT policies are OR-ed, so hms_is_admin() access is unchanged.
CREATE POLICY "Owners read their branch audit log"
  ON public.hms_audit_log FOR SELECT
  USING (
    hostel_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.hms_hostels
      WHERE hms_hostels.id = hms_audit_log.hostel_id
        AND hms_hostels.owner_id = auth.uid()
    )
  );
