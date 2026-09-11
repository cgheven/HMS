-- PUBLIC SELF-REGISTRATION — pending (unverified) signups.
--
-- A public signup must NOT create an auth user / claim the canonical owner-email
-- slot until the email is verified — otherwise an attacker could pre-register a
-- victim's address and deny them registration (security review LOW-1). So a
-- signup writes a row here + emails a token; the OWNER account is created only
-- when the token is verified, by someone who controls the inbox.
--
-- Service-role only: RLS enabled, no policies (deny-all for anon/authenticated).
-- All access is via server actions using createAdminClient().

CREATE TABLE IF NOT EXISTS public.hms_pending_signups (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          text NOT NULL,
  normalized_email text NOT NULL,
  business_name  text,
  owner_name     text,
  phone          text,
  country        text NOT NULL DEFAULT 'PK' CHECK (country ~ '^[A-Z]{2}$'),
  -- SHA-256 hash of the verification token; the raw token lives only in the email
  -- link and this function's memory, never at rest (mirrors the reset-token design).
  token_hash     text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  consumed_at    timestamptz
);

ALTER TABLE public.hms_pending_signups ENABLE ROW LEVEL SECURITY;

-- Look up a verification attempt by its token hash.
CREATE UNIQUE INDEX IF NOT EXISTS hms_pending_signups_token_hash
  ON public.hms_pending_signups (token_hash);

-- At most one LIVE (unconsumed, unexpired) pending signup per canonical email, so
-- re-requesting replaces rather than piles up. Pending rows deliberately do NOT
-- reserve the owner slot (that would reintroduce the pre-registration DoS) — this
-- is only anti-spam housekeeping.
CREATE UNIQUE INDEX IF NOT EXISTS hms_pending_signups_live_email
  ON public.hms_pending_signups (normalized_email)
  WHERE consumed_at IS NULL;

COMMENT ON TABLE public.hms_pending_signups IS
  'Unverified public signups awaiting email verification. Service-role only. The owner account is created on verification, not here — so an unverified signup never claims the canonical owner-email slot.';
