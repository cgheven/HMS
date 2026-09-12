-- Self-service email change (owner "update my login email"), verify-before-switch.
--
-- The new address is confirmed BEFORE the login email is switched — so a typo
-- can't lock the owner out, and no one can move their account to an address they
-- don't control. A request writes a row here + emails a token to the NEW address;
-- the switch happens only when that token is verified (verifyEmailChange), by
-- someone who controls the new inbox. Mirrors hms_pending_signups.
--
-- Service-role only: RLS enabled, no policies (deny-all for anon/authenticated).
-- All access is via server actions using createAdminClient().

CREATE TABLE IF NOT EXISTS public.hms_pending_email_changes (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The authenticated user requesting the change (auth.users / hms_profiles id).
  user_id              uuid NOT NULL,
  new_email            text NOT NULL,
  normalized_new_email text NOT NULL,
  -- SHA-256 of the verification token; the raw token lives only in the email link.
  token_hash           text NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  expires_at           timestamptz NOT NULL,
  consumed_at          timestamptz
);

ALTER TABLE public.hms_pending_email_changes ENABLE ROW LEVEL SECURITY;

-- Look up a verification attempt by its token hash.
CREATE UNIQUE INDEX IF NOT EXISTS hms_pending_email_changes_token_hash
  ON public.hms_pending_email_changes (token_hash);

-- At most one LIVE (unconsumed) request per user, so re-requesting replaces
-- rather than piles up.
CREATE UNIQUE INDEX IF NOT EXISTS hms_pending_email_changes_live_user
  ON public.hms_pending_email_changes (user_id)
  WHERE consumed_at IS NULL;

COMMENT ON TABLE public.hms_pending_email_changes IS
  'Pending self-service email changes awaiting confirmation of the NEW address. Service-role only. The login email is switched on verification, not here.';
