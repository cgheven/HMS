-- Al Noor Boys Hostel — real weekly mess menu (from the hostel's printed
-- template) mapped onto July 2026's actual calendar dates. Replaces the
-- generic placeholder hms_food_items rows this hostel had (July 9-15,
-- unrelated demo dishes). No Sunday entries — the hostel's menu template
-- only defines Monday through Saturday. Also sets meal_times, shown in the
-- tenant welcome WhatsApp message via the {meal_times} placeholder.

DELETE FROM hms_food_items WHERE hostel_id = '39674bb7-f616-4b78-9bb9-f49449cdb95f';

INSERT INTO hms_food_items (hostel_id, date, meal_type, item_name, sort_order)
SELECT
  '39674bb7-f616-4b78-9bb9-f49449cdb95f',
  d::date,
  meal,
  CASE EXTRACT(ISODOW FROM d)::int
    WHEN 1 THEN CASE meal WHEN 'breakfast' THEN 'Paratha, Anda + Tea'      ELSE 'Daal Chawal'    END
    WHEN 2 THEN CASE meal WHEN 'breakfast' THEN 'Paratha, Chana + Tea'     ELSE 'Vegetable'      END
    WHEN 3 THEN CASE meal WHEN 'breakfast' THEN 'Paratha, Allu Bhuji + Tea' ELSE 'Chicken Biryani' END
    WHEN 4 THEN CASE meal WHEN 'breakfast' THEN 'Paratha, Channa + Tea'    ELSE 'Kari Pakora'     END
    WHEN 5 THEN CASE meal WHEN 'breakfast' THEN 'Allu wala Paratha + Tea'  ELSE 'Chicken Allu'    END
    WHEN 6 THEN CASE meal WHEN 'breakfast' THEN 'Naan, Chana + Tea'        ELSE 'Daal Mash'       END
  END,
  CASE meal WHEN 'breakfast' THEN 0 ELSE 1 END
FROM generate_series('2026-07-01'::date, '2026-07-31'::date, interval '1 day') d
CROSS JOIN (VALUES ('breakfast'), ('dinner')) AS meals(meal)
WHERE EXTRACT(ISODOW FROM d)::int BETWEEN 1 AND 6;

UPDATE hms_hostels
SET meal_times = E'Breakfast: 7:00 AM - 9:00 AM\nDinner: 7:00 PM - 9:00 PM'
WHERE id = '39674bb7-f616-4b78-9bb9-f49449cdb95f';
