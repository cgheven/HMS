-- Client social handles for the public branded site: Instagram + Facebook.
--
-- Owner-level, beside subdomain (migration 155) and business_name/logo_url
-- (migration 164) for the same reason those are: this is the identity of the
-- ACCOUNT'S public site, and a multi-branch client has one set of social
-- accounts, not one per branch.
--
-- HANDLES, NOT URLS. The value is rendered into an href on a page served to the
-- public under our wildcard cert, so the owner must never choose the scheme or
-- the host. We store "najamhostels" and the app builds
-- https://instagram.com/najamhostels. A URL column would let an owner save
-- javascript:... or point their own prospects at any site they like. A handle
-- column with the CHECKs below can express neither, because neither charset
-- contains ':' or '/'.
--
-- Both nullable, no default: every existing client renders exactly as it does
-- today until they fill these in.

-- hms_profiles is read by getAuthContext (lib/data.ts) on essentially every
-- authenticated request. The ADD COLUMN is catalog-only and instant, but it
-- takes ACCESS EXCLUSIVE and would queue behind — and block — live traffic if a
-- stray idle-in-transaction session holds a conflicting lock. Fail fast instead.
SET lock_timeout = '3s';

ALTER TABLE public.hms_profiles
  ADD COLUMN IF NOT EXISTS instagram_handle text,
  ADD COLUMN IF NOT EXISTS facebook_handle text;

COMMENT ON COLUMN public.hms_profiles.instagram_handle IS
  'Instagram username only - no @, no URL, e.g. "najamhostels". The public page builds https://instagram.com/{handle}. NULL = no Instagram link shown (the default).';

COMMENT ON COLUMN public.hms_profiles.facebook_handle IS
  'Facebook page username or numeric page id only - no URL, e.g. "najamhostels" or "100064123456789". The public page builds https://facebook.com/{handle}. NULL = no Facebook link shown (the default).';

-- Format CHECKs, not merely the length guards migration 164 used. business_name
-- is free text that only ever lands in a text node; these two land in an href,
-- so the database has to constrain the SHAPE. RLS "User can update own profile"
-- (migration 024) guards only `role`, and a column-level REVOKE is a proven
-- no-op on this table (see 155), so any authenticated account can write its own
-- row from devtools — this constraint is the last line, not the second. It also
-- holds against the service-role save action, because CHECKs are not bypassed
-- the way RLS is.
--
-- Instagram's own rule: 1..30 of [A-Za-z0-9._], no leading or trailing period,
-- no '..'. The app stores lowercase; the CHECK accepts either case so a
-- hand-corrected row is never rejected on capitalisation alone.
ALTER TABLE public.hms_profiles
  DROP CONSTRAINT IF EXISTS hms_profiles_instagram_handle_format;
ALTER TABLE public.hms_profiles
  ADD CONSTRAINT hms_profiles_instagram_handle_format CHECK (
    instagram_handle IS NULL
    OR (
      instagram_handle ~ '^[A-Za-z0-9._]{1,30}$'
      AND instagram_handle !~ '^\.'
      AND instagram_handle !~ '\.$'
      AND instagram_handle !~ '\.\.'
    )
  );

-- Facebook's own vanity-username rule: 5..50 of [A-Za-z0-9.] — no underscores,
-- no hyphens. A page with no vanity name still fits: its numeric id is digits
-- only and facebook.com/{id} resolves to the page, so a client whose only link
-- is .../profile.php?id=1000... can still be represented (lib/social.ts
-- extracts that id rather than rejecting the paste).
ALTER TABLE public.hms_profiles
  DROP CONSTRAINT IF EXISTS hms_profiles_facebook_handle_format;
ALTER TABLE public.hms_profiles
  ADD CONSTRAINT hms_profiles_facebook_handle_format CHECK (
    facebook_handle IS NULL
    OR (
      facebook_handle ~ '^[A-Za-z0-9.]{5,50}$'
      AND facebook_handle !~ '^\.'
      AND facebook_handle !~ '\.$'
      AND facebook_handle !~ '\.\.'
    )
  );

-- Deliberately NO uniqueness and NO self-grant trigger. Migration 155 needed
-- both because a subdomain is a scarce global name served under our wildcard
-- cert, so one owner claiming another's was a real attack. A social handle is
-- neither scarce nor ours: it shows only on its own owner's page, links outward
-- to a third-party site, and two clients linking the same agency-run page is
-- not a conflict. 155's trigger here would make the field un-editable by its
-- own owner, which is the opposite of the requirement. No index either — these
-- columns are never a lookup key.
--
-- Note on escaping: standard_conforming_strings is on by default, so '\.' in a
-- plain single-quoted literal reaches the regex engine as an escaped dot. No
-- E'' prefix needed.
--
-- No new storage bucket, no RLS change, no backfill.
