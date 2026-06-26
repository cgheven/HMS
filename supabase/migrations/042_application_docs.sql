-- Add cnic_doc_path column to applications table
ALTER TABLE hms_tenant_applications
  ADD COLUMN IF NOT EXISTS cnic_doc_path text;

-- Create private application-docs bucket (private, 5 MB limit, images only)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'application-docs',
  'application-docs',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;
-- No public storage policies — all access via admin client in server actions
