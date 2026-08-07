-- AC meter photo evidence.
--
-- Tenants on an AC package are billed from a meter they cannot see being read,
-- so the reading is the operator's word against theirs. These two columns store
-- a photo of the dial behind each number we charge from.
--
-- Two photos, two anchors, because the two readings have different scopes:
--   * move-in  — one per TENANT (hms_tenants.joining_meter_reading is already
--                per-tenant; hms_room_ac_join_readings is derived from it, so
--                the photo belongs with the source, not the derivation).
--   * monthly  — one per ROOM per MONTH. The meter is the room's and its units
--                are split across everyone in it, so a per-tenant photo would
--                mean uploading the same dial 3-4 times and letting the copies
--                drift apart. hms_room_ac_readings is already UNIQUE
--                (room_id, for_month), which is exactly the right grain.
--
-- Purely additive: both columns are nullable with no default, so every existing
-- row and every hostel that never uploads a photo is untouched.

ALTER TABLE public.hms_tenants
  ADD COLUMN IF NOT EXISTS joining_meter_photo TEXT;

ALTER TABLE public.hms_room_ac_readings
  ADD COLUMN IF NOT EXISTS meter_photo TEXT;

COMMENT ON COLUMN public.hms_tenants.joining_meter_photo IS
  'Storage path (not URL) in the private ac-meter-photos bucket for the meter photo taken at move-in. NULL when no photo was captured.';

COMMENT ON COLUMN public.hms_room_ac_readings.meter_photo IS
  'Storage path (not URL) in the private ac-meter-photos bucket for the meter photo backing this month''s reading. NULL when no photo was captured.';

-- ── Bucket ──────────────────────────────────────────────────────────────────
-- PRIVATE, like tenant-documents and unlike room-photos/hostel-covers: this is
-- billing evidence tied to a named tenant, not marketing imagery, so it must
-- never be reachable by guessing a public URL. Reads go out as short-lived
-- signed URLs minted by a server action that has already checked ownership.
--
-- Images only — no application/pdf. A meter photo is a photo; allowing PDF just
-- widens the upload surface for no use case.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'ac-meter-photos',
  'ac-meter-photos',
  false,
  10485760, -- 10 MB
  ARRAY['image/jpeg','image/png','image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- ── Storage RLS ─────────────────────────────────────────────────────────────
-- Every write in this app goes through a server action on the service-role
-- client, which bypasses RLS entirely — so these policies are defense in depth,
-- not the primary guard. They are still written path-scoped rather than
-- bucket-wide: migration 031 had to retrofit exactly that fix onto
-- tenant-documents after 030 granted every authenticated user the whole bucket.
--
-- First path segment is the hostel id, matching the room-photos/hostel-covers
-- layout, so a single ownership subquery scopes all three verbs.

DROP POLICY IF EXISTS "owners can upload ac meter photos" ON storage.objects;
DROP POLICY IF EXISTS "owners can read ac meter photos"   ON storage.objects;
DROP POLICY IF EXISTS "owners can delete ac meter photos" ON storage.objects;

CREATE POLICY "owners can upload ac meter photos" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'ac-meter-photos'
    AND (storage.foldername(name))[1] IN (
      SELECT hostel_id::text FROM hms_owner_hostels WHERE owner_id = auth.uid()
      UNION
      SELECT id::text        FROM hms_hostels       WHERE owner_id = auth.uid()
    )
  );

CREATE POLICY "owners can read ac meter photos" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'ac-meter-photos'
    AND (storage.foldername(name))[1] IN (
      SELECT hostel_id::text FROM hms_owner_hostels WHERE owner_id = auth.uid()
      UNION
      SELECT id::text        FROM hms_hostels       WHERE owner_id = auth.uid()
    )
  );

CREATE POLICY "owners can delete ac meter photos" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'ac-meter-photos'
    AND (storage.foldername(name))[1] IN (
      SELECT hostel_id::text FROM hms_owner_hostels WHERE owner_id = auth.uid()
      UNION
      SELECT id::text        FROM hms_hostels       WHERE owner_id = auth.uid()
    )
  );
