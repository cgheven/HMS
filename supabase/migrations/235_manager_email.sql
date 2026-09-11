-- Managers can now have a real email address, used as their auth login identity
-- (email + password, self-service reset) instead of the phone-only synthetic
-- `<phone>@hms-portal.internal` identity. Existing managers keep the synthetic
-- login (email stays NULL) — the column is nullable, required only for NEW
-- managers at the application layer.
--
-- hms_managers is service-role-write only (owners manage their managers via
-- server actions); no owner-facing RLS write path, so no guard trigger needed.
ALTER TABLE public.hms_managers ADD COLUMN IF NOT EXISTS email text;

-- One email per manager row (case-insensitive). Auth uniqueness is enforced
-- separately by Supabase on the auth user; this stops two manager records in our
-- own table pointing at the same address. Partial so the many NULL (synthetic)
-- managers are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS hms_managers_email_unique
  ON public.hms_managers (lower(email)) WHERE email IS NOT NULL;

COMMENT ON COLUMN public.hms_managers.email IS
  'Real email = auth login identity (Supabase auth user email) for managers created with one. NULL = legacy phone-only manager on the synthetic <phone>@hms-portal.internal identity.';
