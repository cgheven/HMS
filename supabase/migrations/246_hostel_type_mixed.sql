-- Mixed-gender properties (Male / Female / Mixed). UK student accommodation is
-- commonly mixed; Pakistan stays single-gender in practice. Add 'mixed' to the
-- allowed hostel_type values. Existing rows are 'boys'/'girls'/NULL — unaffected.
--
-- Stored values remain boys|girls|mixed; the UI labels them Male/Female/Mixed.
-- 'mixed' has no single gender, so it is only offered where guest registration
-- (Hotel Eye, which files each guest under one derived gender) does NOT apply.

ALTER TABLE public.hms_hostels
  DROP CONSTRAINT IF EXISTS hms_hostels_hostel_type_check;

ALTER TABLE public.hms_hostels
  ADD CONSTRAINT hms_hostels_hostel_type_check
  CHECK (hostel_type IS NULL OR hostel_type = ANY (ARRAY['boys'::text, 'girls'::text, 'mixed'::text]));

-- The onboarding lead-intake form writes hostel_type here and now offers Mixed.
ALTER TABLE public.hms_platform_leads
  DROP CONSTRAINT IF EXISTS hms_platform_leads_hostel_type_check;

ALTER TABLE public.hms_platform_leads
  ADD CONSTRAINT hms_platform_leads_hostel_type_check
  CHECK (hostel_type IS NULL OR hostel_type = ANY (ARRAY['boys'::text, 'girls'::text, 'mixed'::text]));

-- hms_redflags.gender stays boys/girls: the RedFlag registry is Pakistan-only
-- (CNIC-keyed), and a mixed property is a non-PK concept, so 'mixed' never reaches it.
