-- Retention for the password-reset rate-limit table.
--
-- hms_auth_rate_window keys its buckets on the raw values it is limiting, so
-- half its rows are 'pwreset:email:<address>' — cleartext addresses of the
-- people who tried to recover an account. Migration 179 shipped it with no TTL
-- and no reaper. A single penetration test left 193 rows behind, 86 of them
-- addresses; a live endpoint would accumulate them indefinitely, turning an
-- ephemeral counter into a permanent log of who forgot their password and when.
--
-- Nothing reads a window once its hour has passed — hms_auth_rate_hit only ever
-- touches date_trunc('hour', now()) — so anything older is pure liability.
--
-- Pruning happens INSIDE hms_auth_rate_hit rather than on a schedule, because
-- pg_cron is not installed on this project and a reaper that depends on
-- infrastructure nobody set up is a reaper that never runs. The delete is
-- bounded and only fires on a fraction of calls, so it costs nothing on the hot
-- path while guaranteeing the table cannot grow without limit as long as the
-- endpoint is used at all.
--
-- Two hours, not twenty-four: one full hour of history is needed for the
-- current window plus the one that just closed, and there is no reason to keep
-- an address any longer than the ceiling it was enforcing.

delete from public.hms_auth_rate_window
 where window_start < date_trunc('hour', now()) - interval '2 hours';

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
  -- Opportunistic prune. random() rather than every call so a burst does not
  -- turn into a burst of deletes, and the bound means one unlucky caller never
  -- pays for a large sweep. At any realistic volume this fires often enough to
  -- keep the table to a handful of rows.
  IF random() < 0.05 THEN
    DELETE FROM hms_auth_rate_window
     WHERE ctid IN (
       SELECT ctid FROM hms_auth_rate_window
        WHERE window_start < date_trunc('hour', now()) - interval '2 hours'
        LIMIT 500
     );
  END IF;

  INSERT INTO hms_auth_rate_window (bucket, window_start, n)
  VALUES (p_bucket, date_trunc('hour', now()), 1)
  ON CONFLICT (bucket, window_start)
    DO UPDATE SET n = hms_auth_rate_window.n + 1
  RETURNING n INTO v_n;

  RETURN v_n <= p_limit;
END;
$$;

revoke all on function public.hms_auth_rate_hit(text, integer) from public, anon, authenticated;
grant execute on function public.hms_auth_rate_hit(text, integer) to service_role;
