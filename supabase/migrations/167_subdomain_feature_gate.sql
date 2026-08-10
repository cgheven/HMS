-- Curated per-client gate for the branded subdomain — the premium tier of the
-- public site.
--
-- The two halves of the public site are commercially different and this column
-- is the line between them:
--   * The mini website (hms_hostels.listing_enabled, /find/{slug}, logo,
--     business name, socials, theme) is the ACQUISITION hook. Every client gets
--     it, untouched by this flag. Onboarding keeps publishing it by default.
--   * {label}.hostels.yourpulse.io is the PREMIUM add-on: a name of their own,
--     served under our wildcard cert. Granted, not self-served.
--
-- Same shape as hms_hostels.whatsapp_enabled (migration 110) — a capability the
-- client only gets once WE turn it on. Owner-level rather than per-branch
-- because a subdomain names the whole account, not a branch, exactly as
-- migration 155 established when it put `subdomain` on this table.
--
-- Gates CLAIMING a subdomain. It deliberately does NOT tear down one already
-- claimed: three clients are serving live traffic on theirs, and revoking must
-- be a deliberate act (clear the subdomain), never a side effect of a flag.

SET lock_timeout = '3s';

ALTER TABLE public.hms_profiles
  ADD COLUMN IF NOT EXISTS subdomain_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.hms_profiles.subdomain_enabled IS
  'Super Admin only. false = the client cannot claim a branded subdomain; the card shows as a locked upsell and claimMySubdomain rejects. Does NOT affect the mini website (/find/{slug}), which every client gets. Does NOT release an already-claimed subdomain.';

-- Grandfather anyone who already holds one, so this ships as a gate on new
-- claims rather than a removal from existing clients. Verified before writing:
-- 9 owners, 3 hold a subdomain. The other 6 are exactly who this gate is for.
--
-- Deliberately keyed on `subdomain IS NOT NULL` alone. The earlier draft of this
-- migration also matched on listing_enabled and caught all 9, because
-- onboarding-provision.ts:140 publishes every new client's listing — which is
-- the mini website, precisely the thing this flag must NOT govern.
UPDATE public.hms_profiles
SET subdomain_enabled = true
WHERE subdomain IS NOT NULL;

-- Pinned against client self-grant. RLS on hms_profiles guards only `role`
-- (migration 024), and migration 155 proved a column-level REVOKE is a no-op
-- here while a table-wide GRANT exists — so without this an owner could flip the
-- flag from devtools with the anon client and then claim a subdomain, granting
-- themselves a paid feature. A trigger is the only thing that actually holds;
-- migration 110 reached the same conclusion for whatsapp_enabled.
--
-- auth.uid() is NULL for the service-role client, so the Super Admin server
-- action passes straight through; only a browser-side write is blocked.
CREATE OR REPLACE FUNCTION public.hms_guard_subdomain_enabled()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.subdomain_enabled IS DISTINCT FROM OLD.subdomain_enabled
     AND auth.uid() IS NOT NULL
     AND COALESCE((SELECT role FROM public.hms_profiles WHERE id = auth.uid()), '') <> 'super_admin'
  THEN
    RAISE EXCEPTION 'subdomain_enabled can only be changed by a super admin';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS hms_profiles_guard_subdomain_enabled ON public.hms_profiles;
CREATE TRIGGER hms_profiles_guard_subdomain_enabled
  BEFORE UPDATE ON public.hms_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.hms_guard_subdomain_enabled();
