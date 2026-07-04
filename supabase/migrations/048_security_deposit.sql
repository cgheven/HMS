ALTER TABLE hms_package_configs
  ADD COLUMN IF NOT EXISTS security_deposit NUMERIC(10,2) NOT NULL DEFAULT 0;
