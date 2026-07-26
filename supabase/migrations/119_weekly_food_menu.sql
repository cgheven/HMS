-- Migration 119: weekly-recurring food menu option.
-- Owners can opt a hostel into a single Monday-Sunday template that recurs
-- forever, instead of re-entering a real calendar-month grid every month.
-- Default 'monthly' preserves current behavior for every existing hostel.

alter table hms_hostels
  add column if not exists food_menu_type text not null default 'monthly'
    check (food_menu_type in ('monthly', 'weekly'));

alter table hms_food_items
  alter column date drop not null;

-- Must also drop the default — otherwise an insert that omits `date` (every
-- weekly-mode insert) silently gets today's date filled in instead of NULL,
-- which then fails the XOR constraint below.
alter table hms_food_items
  alter column date drop default;

alter table hms_food_items
  add column if not exists day_of_week smallint;

-- ISO 8601 numbering (1=Monday ... 7=Sunday) — matches EXTRACT(ISODOW ...)
-- already used in migration 113_al_noor_july_menu.sql.
alter table hms_food_items
  add constraint hms_food_items_dow_range
    check (day_of_week is null or day_of_week between 1 and 7);

-- Exactly one of date / day_of_week must be set — a row is either a real
-- calendar-date entry (monthly mode) or a weekly-template entry, never both,
-- never neither.
alter table hms_food_items
  add constraint hms_food_items_date_xor_dow
    check ((date is not null) <> (day_of_week is not null));

-- Weekly-mode reads filter by (hostel_id, day_of_week); the existing
-- idx_hms_food_items_hostel_date index doesn't serve that. Partial index
-- keeps it lean since day_of_week is null for every monthly-mode row.
create index if not exists idx_hms_food_items_hostel_dow
  on hms_food_items(hostel_id, day_of_week, meal_type)
  where day_of_week is not null;
