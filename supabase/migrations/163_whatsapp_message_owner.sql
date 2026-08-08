-- Who a WhatsApp message actually went to, when it wasn't a tenant.
--
-- hms_whatsapp_messages only ever recorded tenant_id, so the monitor page shows
-- "—" for every message addressed to a CLIENT rather than a tenant: platform
-- invoice reminders (hms_client_billing_due), account provisioning
-- (hms_client_provisioning_notification) and the owner's daily summary
-- (hms_owner_daily_summary). Those have no tenant by definition — 9 of 18 rows
-- on production.
--
-- Resolving the name from the phone number afterwards was tried and rejected:
-- 923313454321 matches two different profiles (a shared test number), so it
-- would print the wrong person's name on a real message. A blank is bad; a
-- confidently wrong name is worse. The sender knows exactly who it addressed,
-- so it records it.
--
-- Nullable with no default and no backfill: the 9 historical rows genuinely
-- cannot be resolved, and inventing an owner for them would be the same guess
-- in a different place. They stay unattributed and the UI says so.

ALTER TABLE public.hms_whatsapp_messages
  ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.hms_whatsapp_messages.owner_id IS
  'The hostel owner (our client) this message was addressed to, for client-facing messages. NULL for tenant messages — those use tenant_id. Never both.';

-- Drives the "messages to this client" view on the monitor page.
CREATE INDEX IF NOT EXISTS hms_whatsapp_messages_owner_idx
  ON public.hms_whatsapp_messages (owner_id, created_at DESC)
  WHERE owner_id IS NOT NULL;
