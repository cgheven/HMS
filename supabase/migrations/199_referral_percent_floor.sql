-- ─────────────────────────────────────────────────────────────────────────────
-- A referral discount is either off, or it is worth having: 0 or >= 5
-- ─────────────────────────────────────────────────────────────────────────────
--
-- WRITTEN AS `= 0 OR >= 5`, NOT `>= 5`. Two reasons, both load-bearing:
--
--   1. Live rows sit at 0/0 (production: Rajput, with referrals enabled).
--      A blanket floor would reject them, and a row-level CHECK is re-evaluated
--      on EVERY update of the row — so forcing one through would break renaming
--      that branch or toggling any unrelated column until somebody rewrote
--      their discount. No row is rewritten here, in any environment.
--
--   2. 0 is a MEANING, not an absence. 10/0 is referrer-only mode, which the
--      code supports deliberately (lib/referrals-server.ts keeps a tenant code
--      live at referred = 0; hms_submit_referral's 0% kill applies only to
--      source = 'pulse'). A floor that abolished 0 would silently delete a
--      supported configuration. Hence the floor is per-column and independent —
--      there is no joint "both or neither" rule.
--
-- THE LITERAL 5 IS DUPLICATED in lib/referrals.ts as REFERRAL_MIN_PERCENT,
-- which is what the server action and the Marketing inputs both read. A CHECK
-- cannot import an app constant, so the two must be changed together. The app
-- validation is the layer owners actually meet — this constraint is the
-- backstop that catches any writer that skips it (a future action, a script, a
-- support fix in Studio) and should never fire in normal operation.
--
-- NOT VALID first, then VALIDATE as a separate statement: new writes are
-- guarded the instant the first statement commits, and if the row measurement
-- were stale the failure surfaces at VALIDATE with the guard already in place.
--
-- hms_hostels_referral_percent_range (0-100) is deliberately left alone rather
-- than merged: its name is referenced from comments in app/actions/referrals.ts
-- and lib/referrals-server.ts, and merging buys nothing.
--
-- No trigger is touched. hms_prevent_referral_self_grant wraps every percentage
-- guard in `AND auth.uid() IS NOT NULL`, so it blocks all authenticated writes
-- to these columns at any value — a floor added there would be dead code, and
-- the only writer that reaches the columns is the service role.

alter table public.hms_hostels
  add constraint hms_hostels_referral_percent_floor
  check ((referral_referrer_percent = 0 or referral_referrer_percent >= 5)
     and (referral_referred_percent = 0 or referral_referred_percent >= 5))
  not valid;

alter table public.hms_hostels
  validate constraint hms_hostels_referral_percent_floor;
