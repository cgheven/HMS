-- Performance indexes for HMS
-- Every table is queried by hostel_id — without these, Supabase does full table scans.
-- Run this in Supabase SQL Editor after 001 and 002.

-- hms_hostels: looked up on every page load via owner_id
create index if not exists idx_hms_hostels_owner_id
  on hms_hostels(owner_id);

-- hms_expenses: filtered by hostel_id + date range on expenses page
create index if not exists idx_hms_expenses_hostel_date
  on hms_expenses(hostel_id, date desc);

-- hms_kitchen_expenses: same pattern as expenses
create index if not exists idx_hms_kitchen_expenses_hostel_date
  on hms_kitchen_expenses(hostel_id, date desc);

-- hms_food_items: filtered by hostel_id + specific date + meal_type ordering
create index if not exists idx_hms_food_items_hostel_date
  on hms_food_items(hostel_id, date, meal_type);

-- hms_rooms: listed by hostel_id, ordered by room_number
create index if not exists idx_hms_rooms_hostel_room
  on hms_rooms(hostel_id, room_number);

-- hms_rooms: status filter on dashboard (occupied/available counts)
create index if not exists idx_hms_rooms_hostel_status
  on hms_rooms(hostel_id, status);

-- hms_tenants: filtered by hostel_id + is_active on dashboard revenue calc
create index if not exists idx_hms_tenants_hostel_active
  on hms_tenants(hostel_id, is_active);

-- hms_bills: filtered by hostel_id + status (unpaid/overdue for dashboard)
create index if not exists idx_hms_bills_hostel_status_due
  on hms_bills(hostel_id, status, due_date);
