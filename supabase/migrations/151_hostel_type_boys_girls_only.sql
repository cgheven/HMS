-- Narrows hostel_type to the two values that actually exist in the business:
-- boys and girls. 'mixed' and 'family' were never used by any hostel or lead,
-- and offering them was actively harmful — RedFlag refuses any branch whose
-- type is not boys/girls (hms_redflag_branch_gender), so picking "Mixed" in
-- Settings silently disabled the feature with an error that pointed back at
-- the same dropdown that allowed the choice.
--
-- Both columns stay nullable: hms_hostels rows predate the listing feature and
-- hms_platform_leads captures it as optional intake data.

ALTER TABLE hms_hostels DROP CONSTRAINT IF EXISTS hms_hostels_hostel_type_check;
ALTER TABLE hms_hostels
  ADD CONSTRAINT hms_hostels_hostel_type_check
  CHECK (hostel_type IS NULL OR hostel_type IN ('boys', 'girls'));

ALTER TABLE hms_platform_leads DROP CONSTRAINT IF EXISTS hms_platform_leads_hostel_type_check;
ALTER TABLE hms_platform_leads
  ADD CONSTRAINT hms_platform_leads_hostel_type_check
  CHECK (hostel_type IS NULL OR hostel_type IN ('boys', 'girls'));
