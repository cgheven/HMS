-- Al Noor's welcome_message_template was saved before {meal_times} existed
-- as a placeholder, so the saved text has no token for it to fill in —
-- meal times could never show up in the preview or the real message no
-- matter what's typed into the Meal Times field. Append the same
-- {wifi}{menu}{meal_times} sequence the current DEFAULT_WELCOME_TEMPLATE uses.
UPDATE hms_hostels
SET welcome_message_template = replace(
  welcome_message_template,
  'Your room is {room}.{wifi}{menu}',
  'Your room is {room}.{wifi}{menu}{meal_times}'
)
WHERE id = '39674bb7-f616-4b78-9bb9-f49449cdb95f'
  AND welcome_message_template LIKE '%{wifi}{menu}%'
  AND welcome_message_template NOT LIKE '%{meal_times}%';
