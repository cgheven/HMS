-- Adds a short, unguessable public code for the tenant complaint QR-code
-- form (independent of hms_hostels.slug, which is derived from the hostel
-- name and can be long — e.g. "syed-residencies-boys-hostel-ucp" — and is
-- meant for typing/sharing, not for a QR code meant to be printed and
-- scanned). Also unifies the complaint category vocabulary: the new
-- tenant-facing form only offers 4 simple buckets, and rather than maintain
-- two parallel category lists, the owner's existing internal complaint form
-- adopts the same set. plumbing/electricity/furniture collapse into one new
-- "maintenance" bucket; cleanliness/security/other are unchanged.

ALTER TABLE hms_hostels ADD COLUMN IF NOT EXISTS complaint_code text UNIQUE;

CREATE OR REPLACE FUNCTION hms_generate_complaint_code()
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  -- Excludes 0/O/1/l/I — avoids visual ambiguity when read off a printed sheet.
  alphabet text := 'abcdefghjkmnpqrstuvwxyz23456789';
  code text := '';
BEGIN
  FOR i IN 1..6 LOOP
    code := code || substr(alphabet, floor(random() * length(alphabet) + 1)::int, 1);
  END LOOP;
  RETURN code;
END;
$$;

CREATE OR REPLACE FUNCTION hms_set_hostel_complaint_code()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  candidate text;
BEGIN
  IF NEW.complaint_code IS NOT NULL AND NEW.complaint_code <> '' THEN
    RETURN NEW;
  END IF;
  LOOP
    candidate := hms_generate_complaint_code();
    EXIT WHEN NOT EXISTS (SELECT 1 FROM hms_hostels WHERE complaint_code = candidate);
  END LOOP;
  NEW.complaint_code := candidate;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS hms_hostel_auto_complaint_code ON hms_hostels;
CREATE TRIGGER hms_hostel_auto_complaint_code
  BEFORE INSERT ON hms_hostels
  FOR EACH ROW EXECUTE FUNCTION hms_set_hostel_complaint_code();

-- Backfill existing hostels — the trigger above only fires on INSERT.
DO $$
DECLARE
  r RECORD;
  candidate text;
BEGIN
  FOR r IN SELECT id FROM hms_hostels WHERE complaint_code IS NULL LOOP
    LOOP
      candidate := hms_generate_complaint_code();
      EXIT WHEN NOT EXISTS (SELECT 1 FROM hms_hostels WHERE complaint_code = candidate);
    END LOOP;
    UPDATE hms_hostels SET complaint_code = candidate WHERE id = r.id;
  END LOOP;
END $$;

ALTER TABLE hms_complaints DROP CONSTRAINT IF EXISTS hms_complaints_category_check;

UPDATE hms_complaints
SET category = 'maintenance'
WHERE category IN ('plumbing', 'electricity', 'furniture');

ALTER TABLE hms_complaints
  ADD CONSTRAINT hms_complaints_category_check
  CHECK (category IN ('kitchen', 'staff', 'cleanliness', 'maintenance', 'security', 'other'));
