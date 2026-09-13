-- Per-owner serialization lock for billing-affecting property changes (add /
-- tier-crossing). createBranch takes this lock (compare-and-swap on the timestamp)
-- so concurrent add-property requests from one owner run one at a time — closing a
-- TOCTOU race where many parallel adds each read the same property count, each
-- decide the same tier, and all create, landing the owner in a higher tier than
-- they paid for.
--
-- A 30-second staleness window (enforced in code) auto-releases the lock if a
-- request crashes mid-flight, so an owner can never be permanently wedged out.
-- Purely additive and nullable — a verified no-op for every existing row.

ALTER TABLE public.hms_profiles
  ADD COLUMN IF NOT EXISTS billing_lock_at timestamptz;
