-- Remembers which custom package (hms_package_configs.package_prices._custom,
-- a per-hostel JSON list — not its own table, hence no FK) a tenant was placed
-- on. Custom packages always bill as package_tier='space_only'; without this
-- column the Add/Edit Tenant form had no way to recall the selection, so it
-- silently reverted to plain "Space Only" every time the form was reopened.
-- Purely additive — nullable, no backfill, zero risk to existing rows.
ALTER TABLE hms_tenants
  ADD COLUMN IF NOT EXISTS custom_package_id TEXT;
