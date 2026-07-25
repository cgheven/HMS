-- Free-text meal-times field (e.g. "Breakfast: 7:00 AM - 9:00 AM") surfaced
-- in the tenant welcome WhatsApp message via the {meal_times} placeholder —
-- not every hostel serves lunch, and formats vary enough that a single free
-- text field is simpler than rigid per-meal time columns.
alter table hms_hostels
  add column if not exists meal_times text;
