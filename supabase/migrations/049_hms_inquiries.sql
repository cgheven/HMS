CREATE TABLE IF NOT EXISTS hms_inquiries (
  id             UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  contact_name   TEXT        NOT NULL,
  hostel_name    TEXT        NOT NULL,
  phone          TEXT        NOT NULL,
  city           TEXT,
  plan_interest  TEXT,
  message        TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
