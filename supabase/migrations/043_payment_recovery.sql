-- Payment recovery: bank accounts + WhatsApp reminder template per hostel
ALTER TABLE hms_hostels
  ADD COLUMN IF NOT EXISTS payment_methods  JSONB   NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS reminder_template TEXT;
