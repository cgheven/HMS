-- Migration 040: Extend room photos from 2 to 5 slots
ALTER TABLE hms_rooms
  ADD COLUMN IF NOT EXISTS photo_path_3 text,
  ADD COLUMN IF NOT EXISTS photo_path_4 text,
  ADD COLUMN IF NOT EXISTS photo_path_5 text;
