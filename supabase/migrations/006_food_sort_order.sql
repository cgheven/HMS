alter table hms_food_items
  add column if not exists sort_order integer not null default 0;
