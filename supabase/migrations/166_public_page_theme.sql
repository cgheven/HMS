-- Owner-chosen light/dark theme for the public branded site.
--
-- Owner-level, alongside subdomain (155), business_name/logo_url (164) and the
-- social handles (165): all five are the identity of the ACCOUNT'S public site.
-- A client with three branches has one brand and one look, not three.
--
-- NULL means light. That is deliberate and load-bearing: light is what every
-- existing client is being served today, so a NULL column reproduces current
-- behaviour exactly and no backfill is needed. An owner who never opens the new
-- Appearance control sees no change, ever.
--
-- Why a stored preference rather than a per-visitor toggle: the owner is
-- selling rooms with this page and asked to control how it presents. A visitor
-- toggle would also work, but it answers a different question and the two are
-- not mutually exclusive later.
--
-- Not an enum type. A text column with a CHECK is trivially extended to a third
-- value ('auto', say) with one ALTER; a Postgres enum needs ALTER TYPE ... ADD
-- VALUE, which cannot run inside a transaction block on older servers and is
-- awkward to reverse. Migrations 158-165 all chose text + CHECK for the same
-- reason.

-- Same rationale as 165: hms_profiles is read by getAuthContext on essentially
-- every authenticated request, so never let ACCESS EXCLUSIVE queue behind a
-- stray idle transaction.
SET lock_timeout = '3s';

ALTER TABLE public.hms_profiles
  ADD COLUMN IF NOT EXISTS public_theme text;

COMMENT ON COLUMN public.hms_profiles.public_theme IS
  'Appearance of the owner''s public branded page: ''light'' or ''dark''. NULL means light, which is the shipped default — a NULL row renders exactly as it does today. Does NOT affect the HMS dashboard, which is always dark.';

-- The value reaches the app and is used to decide whether the .pulse-public
-- light-theme class is applied. RLS on hms_profiles guards only `role`
-- (migration 024) and a column-level REVOKE is a proven no-op here (155), so an
-- authenticated account can write this column directly from devtools. Constrain
-- it in the database so the app can never receive a value it did not expect.
ALTER TABLE public.hms_profiles
  DROP CONSTRAINT IF EXISTS hms_profiles_public_theme_valid;
ALTER TABLE public.hms_profiles
  ADD CONSTRAINT hms_profiles_public_theme_valid CHECK (
    public_theme IS NULL OR public_theme IN ('light', 'dark')
  );

-- No index: never a lookup key, only ever read as part of the owner's own
-- profile row. No backfill: NULL already means light.
