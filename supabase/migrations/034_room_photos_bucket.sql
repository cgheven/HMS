-- Migration 034: Public room-photos storage bucket

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'room-photos',
  'room-photos',
  true,
  5242880,  -- 5 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Anyone can view room photos (public bucket)
CREATE POLICY "anyone can view room photos" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'room-photos');

-- Only hostel owners/partners can upload photos for their rooms
CREATE POLICY "owners can upload room photos" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'room-photos'
    AND (storage.foldername(name))[1] IN (
      SELECT h.id::text FROM hms_hostels h WHERE h.owner_id = auth.uid()
      UNION
      SELECT oh.hostel_id::text FROM hms_owner_hostels oh WHERE oh.owner_id = auth.uid()
    )
  );

-- Owners can overwrite (update) existing photos
CREATE POLICY "owners can update room photos" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'room-photos'
    AND (storage.foldername(name))[1] IN (
      SELECT h.id::text FROM hms_hostels h WHERE h.owner_id = auth.uid()
      UNION
      SELECT oh.hostel_id::text FROM hms_owner_hostels oh WHERE oh.owner_id = auth.uid()
    )
  );

-- Owners can delete their room photos
CREATE POLICY "owners can delete room photos" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'room-photos'
    AND (storage.foldername(name))[1] IN (
      SELECT h.id::text FROM hms_hostels h WHERE h.owner_id = auth.uid()
      UNION
      SELECT oh.hostel_id::text FROM hms_owner_hostels oh WHERE oh.owner_id = auth.uid()
    )
  );
