-- Migration 031: Tighten tenant-document storage bucket RLS
-- Fix: STORAGE-RLS-001 — the original policies (030) granted ALL authenticated users
-- read/write/delete on the entire bucket. Replace with path-scoped policies so that
-- storage.objects with path {tenantId}/... are only accessible when that tenant's
-- hostel is owned by auth.uid() (direct owner OR via hms_owner_hostels junction).

-- Drop the over-broad policies from migration 030
DROP POLICY IF EXISTS "owners can upload tenant docs" ON storage.objects;
DROP POLICY IF EXISTS "owners can read tenant docs"   ON storage.objects;
DROP POLICY IF EXISTS "owners can delete tenant docs" ON storage.objects;

-- INSERT: only allow uploads where the first path segment is a tenant that belongs
-- to a hostel the caller owns.
CREATE POLICY "owners can upload tenant docs" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'tenant-documents'
    AND (storage.foldername(name))[1] IN (
      SELECT t.id::text
      FROM hms_tenants t
      WHERE t.hostel_id IN (
        SELECT hostel_id FROM hms_owner_hostels WHERE owner_id = auth.uid()
        UNION
        SELECT id        FROM hms_hostels         WHERE owner_id = auth.uid()
      )
    )
  );

-- SELECT: signed-URL generation goes through the server action (which validates
-- ownership), but this policy adds storage-level defense-in-depth.
CREATE POLICY "owners can read tenant docs" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'tenant-documents'
    AND (storage.foldername(name))[1] IN (
      SELECT t.id::text
      FROM hms_tenants t
      WHERE t.hostel_id IN (
        SELECT hostel_id FROM hms_owner_hostels WHERE owner_id = auth.uid()
        UNION
        SELECT id        FROM hms_hostels         WHERE owner_id = auth.uid()
      )
    )
  );

-- DELETE: same ownership scope.
CREATE POLICY "owners can delete tenant docs" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'tenant-documents'
    AND (storage.foldername(name))[1] IN (
      SELECT t.id::text
      FROM hms_tenants t
      WHERE t.hostel_id IN (
        SELECT hostel_id FROM hms_owner_hostels WHERE owner_id = auth.uid()
        UNION
        SELECT id        FROM hms_hostels         WHERE owner_id = auth.uid()
      )
    )
  );
