-- ─────────────────────────────────────────────────────────────────────────────
-- "This lead is not one of our clients" — the override on client detection
-- ─────────────────────────────────────────────────────────────────────────────
--
-- The campaign page now BLOCKS a lead that looks like an existing client, after
-- three live paying clients were found sitting in the lead list as prospects
-- with no flag on them at all: Continental Boys Hostel (status 'new', so it was
-- swept up by "Select all clean"), Makkah Boys Hostel and Syed Residencies.
--
-- None were detectable before. converted_hostel_id is null for ALL 15 hostels —
-- every client was onboarded outside the CRM, so that check has never once
-- fired — and the phone comparison is exact while the numbers differ by a
-- single typo'd digit (client 03214272165 vs lead 03214277165).
--
-- Detection is therefore fuzzy: last-7-digit phone, owner name, and business
-- name token overlap against hms_hostels and hms_profiles. Fuzzy means false
-- positives, and a false positive on a real prospect costs a sale. Hence this
-- column: one click says "I checked, they are not a client", and the lead
-- becomes sendable again permanently.
--
-- Deliberately NOT marketing_opt_out. That is a suppression list — it means
-- "never contact". This is its mirror image: "contact them, the block is
-- wrong". Folding the two together would make an admin clearing a false
-- positive look identical to one honouring a do-not-contact request.

alter table public.hms_platform_leads
  add column if not exists not_a_client boolean not null default false;

comment on column public.hms_platform_leads.not_a_client is
  'Override for campaign client-detection: true means a human confirmed this lead is NOT an existing client, despite matching one on phone/name. Never set automatically.';
