-- Make canonical-email dedup RACE-SAFE and COMPLETE (review findings on 237).
--
-- 237 set normalized_email only in two app server actions, and supabase-js
-- .upsert() doesn't throw, so a concurrent alias race could leave a duplicate
-- loginable owner + a half-normalized row (silent). Fix at the single choke point:
-- the auth-user trigger sets normalized_email for EVERY account-creation path, so
-- a canonical-email collision fails ATOMICALLY inside createUser (the profile
-- INSERT violates the unique index → the trigger raises → the auth.users insert
-- rolls back → no orphan). One SQL normalizer keeps DB + app in lockstep.
--
-- Scope: uniqueness is enforced for OWNERS only — the trial-abuse vector is
-- self-serve owner signups. A real-email manager or partner who legitimately also
-- owns a hostel elsewhere with the same address must not be false-rejected.

-- Canonicalizer — MUST match lib/email-normalize.ts normalizeEmail():
-- lower/trim → strip +tag → for gmail/googlemail strip dots and fold to gmail.com.
-- Malformed input (no local part, or a dotless domain) is returned lower/trimmed
-- unchanged, exactly as the TS guard does.
CREATE OR REPLACE FUNCTION public.hms_normalize_email(p_email text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN e IS NULL OR position('@' in e) < 2 OR position('.' in split_part(e, '@', 2)) = 0
      THEN e
    WHEN split_part(e, '@', 2) IN ('gmail.com', 'googlemail.com')
      THEN replace(regexp_replace(split_part(e, '@', 1), '\+.*$', ''), '.', '') || '@gmail.com'
    ELSE regexp_replace(split_part(e, '@', 1), '\+.*$', '') || '@' || split_part(e, '@', 2)
  END
  FROM (SELECT lower(trim(p_email)) AS e) s;
$$;

-- Trigger now populates normalized_email for every new auth user (all roles),
-- so the column is never NULL for a real account and the index has full coverage.
CREATE OR REPLACE FUNCTION public.hms_handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO hms_profiles (id, email, normalized_email, full_name, phone, role)
  VALUES (
    NEW.id,
    NEW.email,
    public.hms_normalize_email(NEW.email),
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'phone', NULL),
    CASE
      WHEN NEW.raw_user_meta_data->>'role' = 'manager'   THEN 'manager'
      WHEN NEW.raw_user_meta_data->>'role' = 'sales_rep' THEN 'sales_rep'
      WHEN NEW.raw_user_meta_data->>'role' = 'partner'   THEN 'partner'
      ELSE 'owner'
    END
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$function$;

-- Re-backfill through the function so every row matches it exactly.
UPDATE public.hms_profiles
SET normalized_email = public.hms_normalize_email(email)
WHERE email IS NOT NULL
  AND normalized_email IS DISTINCT FROM public.hms_normalize_email(email);

-- Replace the all-role index (237) with an OWNER-scoped one: dedup owners only.
DROP INDEX IF EXISTS public.hms_profiles_normalized_email_unique;
CREATE UNIQUE INDEX IF NOT EXISTS hms_profiles_owner_normalized_email_unique
  ON public.hms_profiles (normalized_email)
  WHERE normalized_email IS NOT NULL AND role = 'owner';
