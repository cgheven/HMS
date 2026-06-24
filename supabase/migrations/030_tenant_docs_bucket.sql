-- Migration 030: Create tenant-documents storage bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'tenant-documents',
  'tenant-documents',
  false,
  10485760, -- 10 MB
  ARRAY['image/jpeg','image/png','image/webp','application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- Allow owners/admins to manage documents for their hostel's tenants
CREATE POLICY "owners can upload tenant docs" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'tenant-documents');

CREATE POLICY "owners can read tenant docs" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'tenant-documents');

CREATE POLICY "owners can delete tenant docs" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'tenant-documents');
