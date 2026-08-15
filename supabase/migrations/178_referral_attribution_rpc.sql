-- Collapse referral attribution into ONE database round trip.
--
-- lib/referral-attribution.ts did this in three: read the branch entitlement,
-- read the matching referral, then update it. That runs on EVERY tenant
-- admission for all 16 clients, and 14 of them will never enable the feature.
-- Functions and database are both in Singapore (vercel.json regions=["sin1"],
-- host aws-1-ap-southeast-1) so each hop is milliseconds rather than the ~264ms
-- the codebase warns about for us-east, but three hops on the busiest write path
-- in the product to serve a feature nobody has switched on is not a trade worth
-- keeping when one hop does the same job.
--
-- Two things improve beyond the round trips:
--
-- ATOMICITY. Read-then-write left a window in which a concurrent admission of
-- the same phone could match the same referral twice. Here the whole decision
-- happens inside one statement, and the UPDATE ... WHERE status = 'pending'
-- is what actually settles the race.
--
-- THE DEADLINE MOVES INTO SQL, where it belongs. The TypeScript version sliced
-- an ISO timestamp to 10 characters and rebuilt it as UTC midnight to compare
-- against a DATE. hms_tenants.check_in is a real DATE and hms_referrals
-- created_at is a timestamptz; the business runs at UTC+5, so a submission at
-- 03:00 PKT is still the previous day in UTC and that arithmetic silently
-- shifted the window by a day. Casting at PKT here removes the class of bug
-- rather than patching an instance of it.
--
-- Returns true only when a referral was actually linked, so the caller can log
-- meaningfully instead of guessing.

create or replace function public.hms_attribute_referral(
  p_tenant_id     uuid,
  p_hostel_id     uuid,
  p_phone_digits  text,
  p_check_in      date,
  p_ttl_days      integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
DECLARE
  v_owner_id    uuid;
  v_referral_id uuid;
  v_admitted    date := coalesce(p_check_in, (now() at time zone 'Asia/Karachi')::date);
BEGIN
  IF p_phone_digits IS NULL OR btrim(p_phone_digits) = '' THEN
    RETURN false;
  END IF;

  -- Entitlement and owner in the same lookup. A branch that has never been
  -- granted the feature stops here, which is the case for 14 of 15 today.
  SELECT h.owner_id INTO v_owner_id
    FROM hms_hostels h
   WHERE h.id = p_hostel_id
     AND h.referral_enabled;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Owner-scoped, not branch-scoped: a referral pays out when the person joins
  -- ANY branch that owner owns. Oldest pending wins, matching the "first
  -- submission wins" rule the partial unique index already enforces.
  --
  -- The deadline is submission date to admission date, both evaluated at PKT,
  -- so the answer does not depend on the hour of day or on when anyone looks.
  SELECT r.id INTO v_referral_id
    FROM hms_referrals r
   WHERE r.owner_id = v_owner_id
     AND r.phone_digits = p_phone_digits
     AND r.status = 'pending'
     AND v_admitted >= (r.created_at at time zone 'Asia/Karachi')::date
     AND v_admitted <= (r.created_at at time zone 'Asia/Karachi')::date + p_ttl_days
   ORDER BY r.created_at ASC
   LIMIT 1;

  IF v_referral_id IS NULL THEN
    RETURN false;
  END IF;

  -- The WHERE clause, not the SELECT above, is what makes this safe under
  -- concurrency: two admissions racing for one referral, only one updates a row.
  -- It also stops a referral the owner already rejected being revived.
  UPDATE hms_referrals
     SET status            = 'joined',
         matched_tenant_id = p_tenant_id,
         matched_at        = v_admitted
   WHERE id = v_referral_id
     AND status = 'pending';

  RETURN FOUND;
END;
$$;

-- Same posture as every other referral object: service role only. The admission
-- paths all hold an admin client; nothing else has any business calling this.
revoke all on function public.hms_attribute_referral(uuid, uuid, text, date, integer)
  from public, anon, authenticated;
grant execute on function public.hms_attribute_referral(uuid, uuid, text, date, integer)
  to service_role;
