-- ---------------------------------------------------------------------------
-- 148. RedFlag: remember WHICH tenant a report is about.
--
-- THE BUG
--
-- A report stored only the person's name, CNIC and phone. Any later step that
-- needed the tenant behind it — specifically the "balance settled" notice —
-- had to re-derive them by matching those values back against hms_tenants.
--
-- Phone numbers are not unique. In live data one branch has SIX tenants
-- sharing 923313454321, and 24 sharing another number: front-desk staff enter
-- the hostel's own number, or a guardian's, when the member has none. So the
-- match returned whichever row the database happened to return first.
--
-- Observed: a report filed against "Musab Khan" (who has an email on file)
-- re-resolved to "Moiz Arain" (who does not). The notice was recorded as
-- "no email on record" and silently never sent. The owner had picked the right
-- person from the dropdown; the server threw that away and guessed.
--
-- THE FIX
--
-- Store the tenant id at file time. A report is about a specific tenancy, so
-- the row should say which one. The report path now writes it, and the resolve
-- notice reads it instead of guessing.
--
-- NULLABLE, and ON DELETE SET NULL: a report must outlive the tenant record it
-- came from. Deleting a tenant cannot be allowed to erase a defaulter report,
-- and it must not fail either — the accusation stands on the identity fields
-- frozen into the row itself, which are what other organisations actually read.
-- The id is an internal convenience, never returned by either read RPC.
--
-- ADDITIVITY: one nullable column plus one index. No existing column, policy,
-- trigger or function is altered. Existing rows keep working through the
-- legacy fallback in notifyResolved().
-- ---------------------------------------------------------------------------

ALTER TABLE public.hms_redflags
  ADD COLUMN IF NOT EXISTS reported_tenant_id uuid
    REFERENCES public.hms_tenants(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.hms_redflags.reported_tenant_id IS
  'The tenancy this report was filed against, captured at file time. Exists because CNIC/phone cannot identify a person reliably — phone numbers are shared across tenants in real data — so re-deriving the tenant later picked the wrong row and sent notices to nobody. Nullable: rows filed before migration 148 have none, and the FK is ON DELETE SET NULL so removing a tenant never erases a report.';

-- Supports "has this branch already reported this tenant" without scanning.
CREATE INDEX IF NOT EXISTS idx_hms_redflags_reported_tenant
  ON public.hms_redflags (reported_tenant_id)
  WHERE reported_tenant_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Backfill, conservatively.
--
-- Only where exactly ONE tenant in the reporting branch matches — by CNIC
-- digits, or by normalised phone AND name. Anything ambiguous is left NULL for
-- the fallback to handle rather than guessed at, since guessing wrong here is
-- how this bug started.
-- ---------------------------------------------------------------------------

UPDATE public.hms_redflags r
   SET reported_tenant_id = m.tenant_id
  FROM (
    SELECT r2.id AS redflag_id, MIN(t.id::text)::uuid AS tenant_id
      FROM public.hms_redflags r2
      JOIN public.hms_tenants t
        ON t.hostel_id = r2.reported_by_hostel_id
       AND (
             (r2.cnic_digits IS NOT NULL
              AND regexp_replace(coalesce(t.cnic, ''), '[^0-9]', '', 'g') = r2.cnic_digits)
             OR
             (r2.phone_digits IS NOT NULL
              AND public.hms_redflag_normalize_phone(t.phone) = r2.phone_digits
              AND lower(btrim(t.full_name)) = lower(btrim(r2.full_name)))
           )
     WHERE r2.reported_tenant_id IS NULL
     GROUP BY r2.id
    HAVING COUNT(DISTINCT t.id) = 1
  ) m
 WHERE r.id = m.redflag_id;
