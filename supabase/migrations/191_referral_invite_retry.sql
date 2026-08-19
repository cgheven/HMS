-- ─────────────────────────────────────────────────────────────────────────────
-- Automatic retry for referral invites that were accepted but never delivered
-- ─────────────────────────────────────────────────────────────────────────────
--
-- link_sent_at records that META ACCEPTED the send, which is not the same thing
-- as the tenant receiving it. Delivery failure arrives later, on the webhook,
-- as status 'undelivered' — by which point the code already looks sent, is
-- excluded from the pending count, and no screen offers a way to try again.
--
-- On the first real blast (Continental, 52 tenants) that stranded 10 people:
--   131026 x8  message undeliverable — number not reachable on WhatsApp
--   130472 x2  Meta withheld it as part of a marketing holdout experiment
--
-- The second class is explicitly temporary and would succeed on a later attempt.
-- Recovering it by hand means an owner reading error codes off a table, which is
-- not a thing owners do — so the retry has to be unattended.
--
-- Attempts are counted on the CODE, not derived from the message log, because
-- the log is per-message: a row that has failed four times has four rows, and
-- "how many times have we tried this tenant" then depends on a join that must
-- stay in step with every future message type. A counter on the thing being
-- retried cannot drift.

alter table public.hms_referral_codes
  add column if not exists invite_attempts smallint not null default 0,
  add column if not exists invite_last_attempt_at timestamptz;

-- Backfill: every code already carrying a link_sent_at has had exactly one
-- attempt, and that is when it happened. Without this, the first retry pass
-- would treat 51 already-delivered codes as never attempted.
update public.hms_referral_codes
   set invite_attempts = 1,
       invite_last_attempt_at = link_sent_at
 where link_sent_at is not null
   and invite_attempts = 0;

comment on column public.hms_referral_codes.invite_attempts is
  'How many times sending this invite has been ATTEMPTED, successful or not. Caps the retry loop.';
comment on column public.hms_referral_codes.invite_last_attempt_at is
  'When the last attempt was made. Drives the retry backoff.';

-- Finds codes worth retrying: the invite was attempted, its most recent message
-- did not arrive, and we have neither exhausted the attempt cap nor tried too
-- recently.
--
-- SECURITY DEFINER for the same reason the rest of this feature is: the caller
-- is a cron route holding the service role, and the function reads across
-- hms_referral_codes, hms_tenants and hms_whatsapp_messages, all of which carry
-- RLS meant for browser sessions.
create or replace function public.hms_referral_invites_to_retry(
  p_hostel_id uuid,
  p_max_attempts smallint,
  p_backoff_hours integer
)
returns table (code_id uuid, error_code integer)
language sql
security definer
set search_path to 'public'
as $$
  SELECT c.id, latest.error_code
  FROM public.hms_referral_codes c
  JOIN public.hms_tenants t ON t.id = c.tenant_id
  -- The most recent invite for this tenant, whatever its outcome. Ordering by
  -- created_at DESC and taking one row is what makes a later success stop the
  -- retries: the newest row is then 'delivered' and fails the status filter.
  JOIN LATERAL (
    SELECT m.status, m.error_code
    FROM public.hms_whatsapp_messages m
    WHERE m.tenant_id = c.tenant_id
      AND m.template LIKE 'hms_referral_invitation%'
    ORDER BY m.created_at DESC
    LIMIT 1
  ) latest ON TRUE
  WHERE c.hostel_id = p_hostel_id
    AND c.is_active
    AND t.is_active
    AND NOT t.is_waiting
    AND coalesce(t.phone_digits, '') <> ''
    AND latest.status IN ('failed', 'undelivered')
    AND c.invite_attempts < p_max_attempts
    AND (
      c.invite_last_attempt_at IS NULL
      OR c.invite_last_attempt_at < now() - make_interval(hours => p_backoff_hours)
    )
  ORDER BY c.invite_last_attempt_at NULLS FIRST
  LIMIT 200;
$$;

revoke all on function public.hms_referral_invites_to_retry(uuid, smallint, integer)
  from public, anon, authenticated;
grant execute on function public.hms_referral_invites_to_retry(uuid, smallint, integer)
  to service_role;
