-- Migration 261: retire the "Name Unknown" province/district option.
--
-- "Name Unknown" is removed from the admission form's province + district
-- dropdowns (lib/hotel-eye-vocabulary.ts) — province/district are mandatory for
-- guest registration, so "Name Unknown" was a stray escape hatch. Any resident
-- already stored as "Name Unknown" is moved to "Other" (still a valid Hotel Eye
-- value) so their edit dropdown keeps a matching option instead of blanking.

UPDATE public.hms_tenants
   SET permanent_province = 'Other', permanent_district = 'Other'
 WHERE permanent_province = 'Name Unknown';

UPDATE public.hms_tenants
   SET permanent_district = 'Other'
 WHERE permanent_district = 'Name Unknown';
