-- Al Noor's saved welcome_message_template is a frozen snapshot (same issue
-- as migration 114) — update its copy to match the new DEFAULT_WELCOME_TEMPLATE
-- wording in lib/whatsapp-welcome.ts.
UPDATE hms_hostels
SET welcome_message_template = replace(
  welcome_message_template,
  'For any queries contact management on this number.',
  'For any queries contact hostel management.'
)
WHERE id = '39674bb7-f616-4b78-9bb9-f49449cdb95f';
