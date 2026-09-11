-- Starter "My Hostel" is created UNLISTED (review LOW-2).
--
-- A brand-new, empty auto-created hostel must never be published to the public
-- /find directory — the owner publishes it when it's ready. Migration 095 itself
-- flagged this ("listing_enabled defaults to true, so each phantom is published…
-- as an empty, nameless-looking hostel") but left owners' starter at true. Public
-- self-registration makes that a live leak: there was a brief window between
-- createUser (trigger publishes) and the app un-publishing it. Fixing it at the
-- trigger removes the window entirely and for every path.
--
-- Safe for existing paths: the super-admin provisioning flows delete the starter
-- hostel and create real branches with their own listing settings, so this only
-- changes the transient default nobody should have been relying on.

CREATE OR REPLACE FUNCTION hms_handle_new_profile()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM 'owner' THEN
    RETURN NEW;
  END IF;
  INSERT INTO hms_hostels (owner_id, name, listing_enabled)
  VALUES (NEW.id, 'My Hostel', false);
  RETURN NEW;
END;
$$;

-- Defense-in-depth on the service-role-only signups table (parity with 179):
-- RLS-with-no-policy already denies, but make the intent explicit.
REVOKE ALL ON public.hms_pending_signups FROM anon, authenticated;
