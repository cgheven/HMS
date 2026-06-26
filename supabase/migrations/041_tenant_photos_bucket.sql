-- Migration 041: Public tenant-photos storage bucket

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'tenant-photos',
  'tenant-photos',
  true,
  2097152,  -- 2 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Anyone can view tenant photos (public bucket — used to display avatars in the dashboard)
CREATE POLICY "anyone can view tenant photos" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'tenant-photos');

-- Only hostel owners/partners can upload photos scoped to their hostel folder
CREATE POLICY "owners can upload tenant photos" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'tenant-photos'
    AND (storage.foldername(name))[1] IN (
      SELECT h.id::text FROM hms_hostels h WHERE h.owner_id = auth.uid()
      UNION
      SELECT oh.hostel_id::text FROM hms_owner_hostels oh WHERE oh.owner_id = auth.uid()
    )
  );

-- Owners can replace existing tenant photos
CREATE POLICY "owners can update tenant photos" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'tenant-photos'
    AND (storage.foldername(name))[1] IN (
      SELECT h.id::text FROM hms_hostels h WHERE h.owner_id = auth.uid()
      UNION
      SELECT oh.hostel_id::text FROM hms_owner_hostels oh WHERE oh.owner_id = auth.uid()
    )
  );

-- Owners can delete tenant photos
CREATE POLICY "owners can delete tenant photos" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'tenant-photos'
    AND (storage.foldername(name))[1] IN (
      SELECT h.id::text FROM hms_hostels h WHERE h.owner_id = auth.uid()
      UNION
      SELECT oh.hostel_id::text FROM hms_owner_hostels oh WHERE oh.owner_id = auth.uid()
    )
  );
