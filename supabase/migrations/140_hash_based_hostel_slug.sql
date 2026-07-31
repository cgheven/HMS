-- Slugs were derived from the hostel's name (hms_set_hostel_slug, migration
-- 027). That has two problems: renaming a hostel never updates its
-- already-published slug (stale/mismatched public URL, e.g. "Rajput Hostel"
-- still serving at /find/my-hostel-6b1082), and a long name produces a long,
-- hard-to-share URL with no cap.
--
-- Every hms_hostels row already has a unique `id` (uuid, default
-- gen_random_uuid()) resolved before this BEFORE INSERT trigger runs, so
-- derive a short, fixed-length slug straight from it instead of the name.
-- It's permanent (a rename can never invalidate it) and always the same
-- length regardless of what the hostel is called.
CREATE OR REPLACE FUNCTION hms_set_hostel_slug()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  hex_id    text;
  len       int := 8;
  candidate text;
BEGIN
  IF NEW.slug IS NOT NULL AND NEW.slug <> '' THEN
    RETURN NEW;
  END IF;
  hex_id := replace(NEW.id::text, '-', '');
  LOOP
    candidate := substr(hex_id, 1, len);
    EXIT WHEN NOT EXISTS (SELECT 1 FROM hms_hostels WHERE slug = candidate AND id <> NEW.id);
    -- id itself is unique, so growing the prefix always resolves by len = 32.
    len := len + 4;
  END LOOP;
  NEW.slug := candidate;
  RETURN NEW;
END;
$$;
