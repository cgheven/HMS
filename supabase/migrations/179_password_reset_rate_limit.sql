-- Rate limiting for the password-reset request endpoint.
--
-- Password reset is the most attacked flow in any product: it is unauthenticated,
-- it sends mail on demand, and success means a full account takeover with no
-- credentials. The two abuses this bounds are (1) using the endpoint as a free
-- mail cannon against a real person's inbox, and (2) probing it to learn which
-- addresses are registered.
--
-- Its own table rather than reusing hms_referral_rate_window: that table is
-- named and documented for referral abuse, and an auth control should not
-- silently share a namespace with a marketing feature — a future cleanup of one
-- must not be able to weaken the other.
--
-- The increment is atomic (INSERT ... ON CONFLICT DO UPDATE ... RETURNING) so N
-- concurrent requests get N distinct counts. A check-then-act would let a burst
-- past the ceiling, which is exactly the shape of request an attacker sends.
create table if not exists public.hms_auth_rate_window (
  bucket       text        not null,
  window_start timestamptz not null,
  n            integer     not null default 0,
  primary key (bucket, window_start)
);

-- Windows are disposable; nothing reads them once their hour has passed.
create index if not exists hms_auth_rate_window_start_idx
  on public.hms_auth_rate_window (window_start);

-- Always increments BEFORE deciding: a refused caller still pays for the
-- attempt, otherwise the ceiling resets for anyone willing to keep hammering it.
create or replace function public.hms_auth_rate_hit(
  p_bucket text,
  p_limit  integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
DECLARE
  v_n integer;
BEGIN
  INSERT INTO hms_auth_rate_window (bucket, window_start, n)
  VALUES (p_bucket, date_trunc('hour', now()), 1)
  ON CONFLICT (bucket, window_start)
    DO UPDATE SET n = hms_auth_rate_window.n + 1
  RETURNING n INTO v_n;

  RETURN v_n <= p_limit;
END;
$$;

-- Same posture as every other privileged object here: RLS on, no policies, and
-- reachable only by the service role. The reset action runs server-side with an
-- admin client; nothing in a browser has any business touching either.
alter table public.hms_auth_rate_window enable row level security;
revoke all on public.hms_auth_rate_window from anon, authenticated;

revoke all on function public.hms_auth_rate_hit(text, integer) from public, anon, authenticated;
grant execute on function public.hms_auth_rate_hit(text, integer) to service_role;
