-- Migration 140 only shortened slugs for hostels created afterward — every
-- hostel onboarded before it (e.g. "my-hostel-6b1082", "faria-branch") kept
-- its old, longer, name-derived slug. Confirmed with the owner that none of
-- these /find URLs have been shared with real clients yet, so it's safe to
-- backfill every existing hostel to the same short id-derived format.
--
-- Extract the id -> slug derivation used by hms_set_hostel_slug() into its
-- own function so the trigger and this one-time backfill share one
-- implementation instead of duplicating the collision-avoidance loop.
CREATE OR REPLACE FUNCTION hms_generate_short_slug(p_id uuid)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  hex_id    text := replace(p_id::text, '-', '');
  len       int  := 8;
  candidate text;
BEGIN
  LOOP
    candidate := substr(hex_id, 1, len);
    EXIT WHEN NOT EXISTS (SELECT 1 FROM hms_hostels WHERE slug = candidate AND id <> p_id);
    len := len + 4;
  END LOOP;
  RETURN candidate;
END;
$$;

CREATE OR REPLACE FUNCTION hms_set_hostel_slug()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.slug IS NOT NULL AND NEW.slug <> '' THEN
    RETURN NEW;
  END IF;
  NEW.slug := hms_generate_short_slug(NEW.id);
  RETURN NEW;
END;
$$;

-- One-time backfill, row by row (not a single set-based UPDATE) so each
-- row's uniqueness check sees the slugs already rewritten earlier in this
-- same loop and can never collide with a sibling being backfilled in the
-- same pass.
DO $$
DECLARE
  h RECORD;
BEGIN
  FOR h IN SELECT id FROM hms_hostels ORDER BY created_at LOOP
    UPDATE hms_hostels SET slug = hms_generate_short_slug(h.id) WHERE id = h.id;
  END LOOP;
END;
$$;
