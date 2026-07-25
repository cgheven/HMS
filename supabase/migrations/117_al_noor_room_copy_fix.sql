-- Al Noor's saved welcome_message_template is a frozen snapshot (same issue
-- as migrations 114/116) — update its copy to match the new phrasing in
-- lib/whatsapp-welcome.ts's DEFAULT_WELCOME_TEMPLATE. Note {room} itself now
-- resolves to "Room 5" (the word "Room" moved into the placeholder value so
-- it degrades gracefully to "a room" when no room is assigned yet).
UPDATE hms_hostels
SET welcome_message_template = replace(
  welcome_message_template,
  'Your room is {room}.',
  'You have been allotted {room}.'
)
WHERE id = '39674bb7-f616-4b78-9bb9-f49449cdb95f';
