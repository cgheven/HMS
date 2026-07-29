-- Weekly mess menu (Roman English) for Syed Residencies Boys Hostel UCP and
-- Syed Residencies Branch UMT, transcribed from a photographed Urdu notice
-- board schedule. Sets food_menu_type='weekly' for both branches (previously
-- 'monthly' with no items yet, so this is a clean switch) and inserts the
-- 7-day breakfast/dinner schedule. A "/" in an item name means either dish
-- may be served that day (operator's choice), not both together — unlike a
-- separate row, which means genuinely served alongside the others that day.

UPDATE hms_hostels
SET food_menu_type = 'weekly'
WHERE id IN ('1ed0450f-99e5-4e24-a9b3-6dda70bcc35b', 'f7b07eb9-6300-4446-8d9b-6308b8f9e03e');

INSERT INTO hms_food_items (hostel_id, date, day_of_week, meal_type, item_name, sort_order)
SELECT h.hostel_id, NULL, m.day_of_week, m.meal_type, m.item_name, m.sort_order
FROM (VALUES
  -- Monday
  (1, 'breakfast', 'Aloo Bhujia Paratha', 0),
  (1, 'dinner',    'Biryani', 0),
  (1, 'dinner',    'Raita', 1),
  -- Tuesday
  (2, 'breakfast', 'Chana Paratha', 0),
  (2, 'dinner',    'Daal (Chana / Moong Masoor)', 0),
  (2, 'dinner',    'Roti', 1),
  -- Wednesday
  (3, 'breakfast', 'Omelette Paratha', 0),
  (3, 'dinner',    'Chicken Qorma / Chicken Karahi', 0),
  -- Thursday
  (4, 'breakfast', 'Aloo Paratha', 0),
  (4, 'breakfast', 'Raita', 1),
  (4, 'dinner',    'Chicken Pulao / Chana Chawal', 0),
  (4, 'dinner',    'Raita', 1),
  -- Friday
  (5, 'breakfast', 'Chana Paratha', 0),
  (5, 'dinner',    'Mausami Sabzi', 0),
  -- Saturday
  (6, 'breakfast', 'Omelette Paratha', 0),
  (6, 'dinner',    'Matar Qeema / Aloo Qeema', 0),
  -- Sunday
  (7, 'breakfast', 'Aloo Paratha', 0),
  (7, 'breakfast', 'Raita', 1),
  (7, 'dinner',    'Aloo Chicken / Palak Chicken', 0)
) AS m(day_of_week, meal_type, item_name, sort_order)
CROSS JOIN (VALUES
  ('1ed0450f-99e5-4e24-a9b3-6dda70bcc35b'::uuid),
  ('f7b07eb9-6300-4446-8d9b-6308b8f9e03e'::uuid)
) AS h(hostel_id);
