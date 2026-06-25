-- Migration 035: Second room photo slot
ALTER TABLE hms_rooms ADD COLUMN IF NOT EXISTS photo_path_2 text;
