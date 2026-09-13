-- Property Type — a new, optional business attribute captured at signup
-- (Hostel, Student Accommodation, Co-living, HMO, Boarding House, Shared
-- Accommodation, or a free-text "Other"). This is SEPARATE from hostel_type,
-- which is the gender designation (boys/girls/mixed) — do not conflate them.
--
-- Free text by design (the "Other" option is custom), so there is NO CHECK
-- constraint; the server whitelists the presets and length-caps custom values.
-- The value is captured on the pending signup row so it survives request ->
-- provision, then copied onto the hostel. Existing rows are NULL — unaffected.

ALTER TABLE public.hms_hostels
  ADD COLUMN IF NOT EXISTS property_type text;

ALTER TABLE public.hms_pending_signups
  ADD COLUMN IF NOT EXISTS property_type text;
