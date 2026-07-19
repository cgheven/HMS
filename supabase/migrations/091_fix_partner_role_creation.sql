-- hms_handle_new_user() (the AFTER INSERT ON auth.users trigger) already reads
-- raw_user_meta_data->>'role' to assign 'manager'/'sales_rep' at creation time,
-- but never learned about 'partner' — it silently defaulted every partner
-- signup to 'owner'. createPartner() then tried to UPDATE that row's role to
-- 'partner', which hms_block_role_escalation (BEFORE UPDATE, blocks any role
-- change unless the caller is a super_admin) always rejects for service-role
-- calls, since auth.uid() is null outside a real user session. Every partner
-- creation attempt failed after already creating the auth user + a stray
-- "My Hostel" (via hms_handle_new_profile, which fires for any non-super_admin
-- role). Fix: assign the correct role at INSERT time so no UPDATE is needed.

CREATE OR REPLACE FUNCTION public.hms_handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO hms_profiles (id, email, full_name, phone, role)
  VALUES (
    NEW.id,
    NEW.email,
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
