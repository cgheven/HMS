-- Branded public subdomains: {subdomain}.hostels.yourpulse.io serves the same
-- public listing as /find/{slug}.
--
-- Lives on hms_profiles (the owner), NOT hms_hostels, because a subdomain
-- represents a BUSINESS and a business can have several branches — exactly the
-- owner-scoped resolution getPublicHostelsByOwner already performs. The
-- existing hms_hostels.slug is deliberately untouched: migration 140 made it a
-- permanent id-derived hash precisely so a published /find/{slug} URL can never
-- break, and those URLs are already in tenants' WhatsApp history.
--
-- Nullable: almost every owner has no subdomain, and the feature must stay
-- entirely opt-in. NULL rows are ignored by the unique index below.

-- hms_profiles is read by getAuthContext on essentially every authenticated
-- request. The table is tiny so the rewrite is instant, but ALTER TABLE takes
-- ACCESS EXCLUSIVE and would queue behind (and block) traffic if a stray
-- idle-in-transaction session holds a conflicting lock. Fail fast instead.
SET lock_timeout = '3s';

ALTER TABLE public.hms_profiles
  ADD COLUMN IF NOT EXISTS subdomain text;

-- Partial unique index rather than a UNIQUE constraint: Postgres treats every
-- NULL as distinct so a plain UNIQUE would work too, but the partial index is
-- smaller and states the intent — only real subdomains are constrained.
CREATE UNIQUE INDEX IF NOT EXISTS hms_profiles_subdomain_key
  ON public.hms_profiles (subdomain)
  WHERE subdomain IS NOT NULL;

-- Shape: a valid DNS label — lowercase alphanumeric and hyphens, never leading
-- or trailing hyphen, 3..63 characters. The regex enforces the length itself
-- (1 + 1..61 + 1), so no separate length check is needed.
--
-- Reserved labels are refused at the database level, not just in the UI: a
-- client taking "www", "api" or "admin" would shadow infrastructure hostnames
-- under *.hostels.yourpulse.io, and the app's own hostnames are listed so a
-- future move of hostel./hms. under this zone can't be hijacked either.
ALTER TABLE public.hms_profiles
  DROP CONSTRAINT IF EXISTS hms_profiles_subdomain_format;

ALTER TABLE public.hms_profiles
  ADD CONSTRAINT hms_profiles_subdomain_format CHECK (
    subdomain IS NULL
    OR (
      subdomain ~ '^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$'
      AND subdomain NOT IN (
        -- infrastructure
        'www', 'api', 'admin', 'app', 'mail', 'email', 'smtp', 'imap', 'pop',
        'ftp', 'ns', 'ns1', 'ns2', 'dns', 'mx', 'cdn', 'static', 'assets',
        'media', 'files', 'img', 'images', 'localhost', 'root', 'system',
        -- environments
        'dev', 'development', 'stage', 'staging', 'test', 'testing', 'demo',
        'preview', 'sandbox', 'beta', 'alpha', 'local',
        -- product / brand
        'pulse', 'hostel', 'hostels', 'hms', 'yourpulse', 'portal', 'dashboard',
        'status', 'blog', 'help', 'support', 'docs', 'about', 'contact',
        -- existing app route namespaces, so a subdomain can never be confused
        -- with one of our own paths in a link or a support conversation
        'login', 'auth', 'account', 'signup', 'register', 'onboarding',
        'billing', 'invoice', 'invoices', 'find', 'join', 'complaint',
        'sales', 'super', 'superadmin', 'super-admin', 'partner', 'partners',
        'manager', 'managers', 'owner', 'owners', 'tenant', 'tenants',
        'guide', 'pricing', 'settings', 'r', 's',
        -- credential / payment lures: a label like "secure" or "verify" under
        -- our own wildcard cert is a ready-made phishing origin, and the CHECK
        -- cannot be widened later without another migration
        'secure', 'signin', 'log-in', 'pay', 'payment', 'payments', 'checkout',
        'verify', 'verification', 'password', 'reset', 'wallet', 'refund',
        'id', 'my'
      )
    )
  );

-- The "User can update own profile" policy (migration 024) is USING
-- (auth.uid() = id) with a WITH CHECK that guards only `role` — every other
-- column is writable by the row's owner, and lib/supabase/client.ts ships a
-- session-carrying anon browser client. Unguarded, any authenticated account
-- could claim an arbitrary label from devtools; the unique index above makes
-- that squat permanent, and a rival owner claiming a competitor's name would
-- have their own listing served under it on our wildcard cert.
--
-- A column-level REVOKE does NOT work here: `authenticated` and `anon` hold
-- table-wide UPDATE on hms_profiles (Supabase's default grant), and Postgres
-- ignores a column-level revoke while a table-level grant stands — verified
-- against production, has_column_privilege still returned true afterwards.
--
-- So use the same trigger pattern migration 110 already uses to pin
-- hms_hostels.whatsapp_enabled against owner self-grant. auth.uid() is NULL
-- for service-role connections, so createAdminClient (the intended admin
-- provisioning path) writes freely while any real user session is refused.
CREATE OR REPLACE FUNCTION hms_prevent_subdomain_self_grant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.subdomain IS DISTINCT FROM OLD.subdomain AND auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Forbidden: subdomain can only be changed by Super Admin';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS hms_block_subdomain_self_grant ON public.hms_profiles;

CREATE TRIGGER hms_block_subdomain_self_grant
  BEFORE UPDATE ON public.hms_profiles
  FOR EACH ROW
  EXECUTE FUNCTION hms_prevent_subdomain_self_grant();

COMMENT ON COLUMN public.hms_profiles.subdomain IS
  'Owner-level branded public subdomain label, e.g. "chohanexecutive" serves chohanexecutive.hostels.yourpulse.io. NULL = no branded subdomain (the default). Public listing only — never used for auth or dashboard routing.';
