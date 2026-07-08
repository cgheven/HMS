-- Migration 058: Seed hms_package_configs for hostels that don't have a row yet.
-- Branches onboarded via migrations 052-056 were never given a package config row,
-- which causes "AC per-unit rate is not configured" on the first AC billing apply.
-- Inserts a placeholder row (all rates = 0) so Settings → Packages can be used to
-- set the real values without hitting a NULL config.

INSERT INTO hms_package_configs (hostel_id, food_monthly_rate, ac_per_unit_rate)
SELECT id, 0, 0
FROM hms_hostels
WHERE id NOT IN (SELECT hostel_id FROM hms_package_configs)
ON CONFLICT (hostel_id) DO NOTHING;
