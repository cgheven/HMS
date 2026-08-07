-- Make the AC meter photo bucket public.
--
-- 158 created it private, on the reasoning that anything attached to a named
-- tenant should not be reachable by URL. Reviewed and overruled by the product
-- owner: a photograph of an electricity dial carries no personal data — no
-- face, no CNIC, no name, nothing a tenant would mind being seen — and the
-- signed-URL round trip put a visible delay in front of a picture that operators
-- open constantly while reconciling a month's units.
--
-- What this does NOT change: writes. Uploading, replacing and deleting still go
-- through the server actions and the owner-scoped policies from 158, so a public
-- read grant does not become a public write grant.
--
-- The path still contains only opaque UUIDs (hostel / tenant or room / random
-- filename), so a public bucket does not make anything enumerable — you cannot
-- walk from one photo to the next without already holding the ids.

UPDATE storage.buckets
SET public = true
WHERE id = 'ac-meter-photos';

COMMENT ON COLUMN public.hms_tenants.joining_meter_photo IS
  'Storage path (not URL) in the public ac-meter-photos bucket for the meter photo taken at move-in. NULL when no photo was captured.';

COMMENT ON COLUMN public.hms_room_ac_readings.meter_photo IS
  'Storage path (not URL) in the public ac-meter-photos bucket for the meter photo backing this month''s reading. NULL when no photo was captured.';
