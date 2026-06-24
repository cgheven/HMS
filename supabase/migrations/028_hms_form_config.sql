-- Migration 028: Per-hostel registration form configuration
ALTER TABLE hms_hostels
  ADD COLUMN IF NOT EXISTS form_config jsonb NOT NULL DEFAULT '{
    "email":           {"enabled": true,  "required": false},
    "cnic":            {"enabled": true,  "required": false},
    "package_tier":    {"enabled": true,  "required": false},
    "room_preference": {"enabled": true,  "required": false},
    "move_in_date":    {"enabled": true,  "required": false},
    "notes":           {"enabled": true,  "required": false}
  }';
