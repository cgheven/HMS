-- Migration 033: Room photos + WhatsApp contact + Sunday food flag

-- Room photo (public URL from room-photos bucket)
ALTER TABLE hms_rooms
  ADD COLUMN IF NOT EXISTS photo_path text;

-- WhatsApp number distinct from the main phone (optional; falls back to phone)
ALTER TABLE hms_hostels
  ADD COLUMN IF NOT EXISTS whatsapp text;

-- Let owners signal that the kitchen is closed on Sundays
ALTER TABLE hms_hostels
  ADD COLUMN IF NOT EXISTS food_closed_on_sundays boolean NOT NULL DEFAULT false;
