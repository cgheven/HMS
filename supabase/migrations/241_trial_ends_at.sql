-- 14-day free trial for self-serve signups.
--
-- A self-registered owner (app/actions/signup.ts verifySignupAndProvision) gets
-- trial_ends_at = now() + 14 days. When the trial lapses and they have not
-- subscribed, the daily freeze cron flips them to frozen = true (read-only until
-- they pay) — reusing the exact same freeze machinery as unpaid bank clients
-- (requireNotFrozen write-block + the dashboard suspended banner). Paying exits
-- the trial: the Paddle webhook clears frozen AND nulls trial_ends_at.
--
-- trial_ends_at is NULL for every existing owner (manually provisioned / bank /
-- Paddle clients), so none of them are trial accounts and none are affected —
-- a verified no-op for all current data.

ALTER TABLE public.hms_profiles
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz;

COMMENT ON COLUMN public.hms_profiles.trial_ends_at IS
  'Self-serve free-trial expiry. NULL = not a trial account (paid/manual/existing). '
  'Set at self-registration; cleared on first Paddle payment. Guarded: super-admin only.';

-- Guard: like frozen/plan/country, trial_ends_at is billing-critical. A table-wide
-- GRANT makes a column REVOKE a no-op and owners CAN self-UPDATE hms_profiles (RLS
-- only pins role/owner_id), so without this an owner could PostgREST-UPDATE their
-- own trial_ends_at and extend the trial indefinitely. Service role (auth.uid()
-- IS NULL — signup provisioning, the webhook, super-admin) passes; a super_admin
-- session passes; any other session that changes the value is rejected.
CREATE OR REPLACE FUNCTION public.hms_guard_trial_ends_at()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.trial_ends_at IS DISTINCT FROM OLD.trial_ends_at
     AND auth.uid() IS NOT NULL
     AND COALESCE((SELECT role FROM public.hms_profiles WHERE id = auth.uid()), '') <> 'super_admin'
  THEN
    RAISE EXCEPTION 'trial_ends_at can only be changed by a super admin';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS hms_profiles_guard_trial_ends_at ON public.hms_profiles;
CREATE TRIGGER hms_profiles_guard_trial_ends_at
  BEFORE UPDATE ON public.hms_profiles
  FOR EACH ROW EXECUTE FUNCTION public.hms_guard_trial_ends_at();

-- Freeze self-serve trials whose 14 days have lapsed and who have not subscribed.
-- Mirrors hms_freeze_overdue_accounts (migration 232): service-role only, one
-- atomic statement, skips super_admin, already-frozen rows, and anyone with a
-- live Paddle subscription (belt-and-suspenders — paying also nulls trial_ends_at,
-- so a paid owner is already off this list). Returns the owners it froze.
-- Unfreeze is NOT done here — payment clears frozen (Paddle webhook).
CREATE OR REPLACE FUNCTION public.hms_freeze_expired_trials()
  RETURNS SETOF uuid
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
  UPDATE public.hms_profiles p
  SET frozen = true
  WHERE p.trial_ends_at IS NOT NULL
    AND p.trial_ends_at < now()
    AND p.frozen = false
    AND p.role <> 'super_admin'
    AND NOT EXISTS (
      SELECT 1 FROM public.hms_paddle_subscriptions s
      WHERE s.owner_id = p.id
        AND s.status IN ('active','trialing','past_due','paused')
    )
  RETURNING p.id;
$$;

REVOKE ALL ON FUNCTION public.hms_freeze_expired_trials() FROM PUBLIC, anon, authenticated;
-- Explicit grant to the cron caller (createAdminClient -> service_role via
-- PostgREST), matching hms_freeze_overdue_accounts (migration 232). Without it the
-- feature can be silently inert if the project's default privileges don't already
-- cover service_role for new public functions.
GRANT EXECUTE ON FUNCTION public.hms_freeze_expired_trials() TO service_role;
