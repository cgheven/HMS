-- Migration 202: marketing-assets bucket — WhatsApp campaign header images
--
-- Meta fetches an IMAGE-header template's picture itself, from a public URL we
-- hand it per send. Until now that URL was a convention over the app bundle:
-- public/marketing/{template}.png. That made every new template a code change —
-- add the file, commit, deploy — and a template approved before the deploy
-- landed could not be sent or even tested, because the send is REJECTED when
-- the link 404s (and worse, accepted-then-silently-undelivered; see
-- assertHeaderImageReachable).
--
-- Storage removes the deploy from that loop entirely: a super admin uploads the
-- artwork on the Marketing page and the same URL is public immediately, from a
-- dev machine as much as from production.
--
-- PUBLIC, like room-photos and hostel-covers: Meta arrives with none of our
-- cookies, so a signed URL would 401 at the only reader that matters.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'marketing-assets',
  'marketing-assets',
  true,
  5242880,  -- 5 MB; Meta's own template media ceiling
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "anyone can view marketing assets" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'marketing-assets');

-- Deliberately no INSERT/UPDATE/DELETE policy.
--
-- Unlike room-photos, where the browser uploads directly and RLS has to scope
-- the write, every write here goes through uploadCampaignHeaderImage, which is
-- super-admin gated and uses the service role. No policy means no authenticated
-- client can write to this bucket at all — which is correct, since the only
-- people who should be able to change what goes out to prospects are the ones
-- who can already reach that page.
