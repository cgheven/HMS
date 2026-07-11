-- Seater pricing: automatic room pricing keyed by seat count (1-7) x AC status,
-- so a hostel can price rooms by capacity once instead of typing a rent into
-- every individual room. Purely additive/opt-in — a hostel that never sets
-- this JSONB sees zero change; existing per-room monthly_rent and package
-- pricing continue to work exactly as before as fallbacks.

ALTER TABLE hms_package_configs
  ADD COLUMN IF NOT EXISTS seater_prices JSONB NOT NULL DEFAULT '{}'::jsonb;
