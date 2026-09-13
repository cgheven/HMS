-- Fencing token for the per-owner billing lock (see migration 251).
--
-- billing_lock_at alone is a bare time-lease: a request that runs past the
-- staleness window can have its lock stolen by a concurrent request, and the
-- original's unconditional release then clobbers the stealer's lock — re-opening
-- the parallel-add tier race the lock exists to close. The token fixes that:
--   • acquire  → stamp billing_lock_at = now() AND billing_lock_token = <uuid>
--   • re-check → before the irreversible INSERT, confirm the stored token is
--                still ours (we were not preempted)
--   • release  → clear ONLY if the stored token still equals ours, so a
--                superseded request can never wipe the current holder's lock
--
-- Purely additive and nullable — a verified no-op for every existing row.

ALTER TABLE public.hms_profiles
  ADD COLUMN IF NOT EXISTS billing_lock_token text;
