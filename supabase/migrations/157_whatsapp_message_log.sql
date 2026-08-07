-- WhatsApp send + delivery log.
--
-- hms_whatsapp_failures records only what broke, so "was this message actually
-- sent?" has never been answerable: the absence of a failure could equally mean
-- the tenant was skipped, had no phone, or the job never ran. This table holds
-- one row per ATTEMPT, successful or not.
--
-- It also carries delivery state, which the send API cannot give us. A 200 from
-- Meta means "queued", not "received" — sent/delivered/read/undelivered arrive
-- later on the webhook, keyed by the wamid returned at send time. Without that
-- id there is nothing to match a status update against, which is why it is
-- stored even though nothing reads it at insert time.
--
-- Purely additive: hms_whatsapp_failures is left exactly as it is, so every
-- existing insert keeps working while this runs alongside it.

CREATE TABLE IF NOT EXISTS public.hms_whatsapp_messages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hostel_id    uuid REFERENCES public.hms_hostels(id) ON DELETE SET NULL,
  tenant_id    uuid REFERENCES public.hms_tenants(id) ON DELETE SET NULL,
  phone        text NOT NULL,
  message_type text NOT NULL,
  /** Approved template name, or null for a free-form text send. */
  template     text,
  /** Meta's message id (wamid...). Null when the request never reached Meta. */
  wamid        text,
  status       text NOT NULL DEFAULT 'queued'
               CHECK (status IN ('queued', 'sent', 'delivered', 'read', 'undelivered', 'failed')),
  /** Populated on failure, and on an undelivered webhook (e.g. 131026 — the
   *  number is not a WhatsApp user). */
  error        text,
  error_code   int,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- The webhook arrives keyed ONLY by wamid, so this lookup is on the hot path of
-- every status callback. Partial: rows that never reached Meta have no wamid.
CREATE UNIQUE INDEX IF NOT EXISTS hms_whatsapp_messages_wamid_key
  ON public.hms_whatsapp_messages (wamid)
  WHERE wamid IS NOT NULL;

-- Drives the monitoring page: newest first, filtered by branch.
CREATE INDEX IF NOT EXISTS hms_whatsapp_messages_hostel_created_idx
  ON public.hms_whatsapp_messages (hostel_id, created_at DESC);

-- Drives the failures view without scanning the whole table.
CREATE INDEX IF NOT EXISTS hms_whatsapp_messages_status_idx
  ON public.hms_whatsapp_messages (status, created_at DESC);

COMMENT ON TABLE public.hms_whatsapp_messages IS
  'One row per WhatsApp send attempt. status starts at queued/failed from the API response, then advances via the Meta delivery webhook keyed on wamid.';
