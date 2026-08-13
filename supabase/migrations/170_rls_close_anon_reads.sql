-- Close three tables that were readable by anyone holding the anon key.
--
-- The anon key is PUBLIC by design — it ships in the browser bundle on
-- hostel.yourpulse.io. It is safe only because RLS decides what it can see.
-- These three tables had RLS switched off while still carrying the default
-- Supabase table-level GRANTs to anon/authenticated, so PostgREST served them
-- in full to an unauthenticated caller. Verified live before this migration:
--
--   GET /rest/v1/hms_whatsapp_messages?select=*  -> rows returned
--   GET /rest/v1/hms_room_ac_checkout_readings   -> rows returned
--
-- hms_whatsapp_messages is the worst of the three: one row per message ever
-- sent, holding the phone number of every tenant and every client.
--
-- No policies are added, which is the point — with RLS on and no policy, anon
-- and authenticated match nothing while service_role bypasses RLS entirely.
-- Every reader of these tables in the codebase already uses
-- createAdminClient() (verified across 10 call sites), so nothing legitimate
-- loses access. Same shape as hms_lead_activities and hms_lead_campaign_sends.
--
-- Revoking the GRANTs instead would also work, but RLS is what the other 46
-- public tables use, and one consistent mechanism beats two.

alter table public.hms_whatsapp_messages          enable row level security;
alter table public.hms_inquiries                  enable row level security;
alter table public.hms_room_ac_checkout_readings  enable row level security;
