-- Payment confirmations now send through the approved Meta template
-- hms_payment_confirmed, so a failed send needs somewhere honest to land.
--
-- hms_whatsapp_failures.message_type is CHECK-constrained to the five kinds
-- that existed when migration 118 was written. Without 'receipt' the failure
-- log would either reject the row — throwing inside the fire-and-forget
-- confirmation path — or have to mislabel receipts as reminders, which makes
-- the log useless for the one thing it exists for.
--
-- Additive: widening a CHECK accepts everything it accepted before, so no
-- existing row is affected and nothing needs backfilling.

ALTER TABLE public.hms_whatsapp_failures
  DROP CONSTRAINT IF EXISTS hms_whatsapp_failures_message_type_check;

ALTER TABLE public.hms_whatsapp_failures
  ADD CONSTRAINT hms_whatsapp_failures_message_type_check
  CHECK (message_type IN ('reminder', 'announcement', 'welcome', 'leaving_reminder', 'test', 'receipt'));
