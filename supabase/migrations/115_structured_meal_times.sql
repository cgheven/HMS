-- Replace the free-text meal_times field with structured per-meal from/to
-- times ({breakfast, lunch, dinner}, each optional {from, to}) so the
-- welcome message can render a clean "Breakfast: X - Y" line per meal
-- instead of one opaque free-text blob. Only Al Noor has a value today
-- (verified live), so this is a clean type change, not a data migration.
alter table hms_hostels
  alter column meal_times drop default,
  alter column meal_times type jsonb using '{}'::jsonb,
  alter column meal_times set default '{}'::jsonb,
  alter column meal_times set not null;

-- Al Noor's real times from the hostel's printed menu template — no lunch
-- served, matching the source photo (Breakfast/Dinner only).
UPDATE hms_hostels
SET meal_times = '{"breakfast": {"from": "7:00 AM", "to": "9:00 AM"}, "dinner": {"from": "7:00 PM", "to": "9:00 PM"}}'::jsonb
WHERE id = '39674bb7-f616-4b78-9bb9-f49449cdb95f';
