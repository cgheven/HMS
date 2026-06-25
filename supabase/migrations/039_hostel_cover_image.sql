-- Migration 039: Hostel cover image for /find directory cards

-- Add cover_image_url column to hms_hostels
ALTER TABLE hms_hostels
  ADD COLUMN IF NOT EXISTS cover_image_url text;

-- Public bucket for hostel cover images (JPEG/PNG/WEBP, max 3 MB)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'hostel-covers',
  'hostel-covers',
  true,
  3145728,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Anyone can view cover images (public bucket)
CREATE POLICY "anyone can view hostel covers" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'hostel-covers');

-- Only the hostel owner can upload / replace their cover
CREATE POLICY "owners can upload hostel covers" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'hostel-covers'
    AND (storage.foldername(name))[1] IN (
      SELECT h.id::text FROM hms_hostels h WHERE h.owner_id = auth.uid()
      UNION
      SELECT oh.hostel_id::text FROM hms_owner_hostels oh WHERE oh.owner_id = auth.uid()
    )
  );

CREATE POLICY "owners can update hostel covers" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'hostel-covers'
    AND (storage.foldername(name))[1] IN (
      SELECT h.id::text FROM hms_hostels h WHERE h.owner_id = auth.uid()
      UNION
      SELECT oh.hostel_id::text FROM hms_owner_hostels oh WHERE oh.owner_id = auth.uid()
    )
  );

CREATE POLICY "owners can delete hostel covers" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'hostel-covers'
    AND (storage.foldername(name))[1] IN (
      SELECT h.id::text FROM hms_hostels h WHERE h.owner_id = auth.uid()
      UNION
      SELECT oh.hostel_id::text FROM hms_owner_hostels oh WHERE oh.owner_id = auth.uid()
    )
  );
