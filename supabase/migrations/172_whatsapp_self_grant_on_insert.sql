-- Close the INSERT half of the whatsapp_enabled self-grant hole.
--
-- hms_block_whatsapp_self_grant fired BEFORE UPDATE only. It stopped an owner
-- flipping the flag on an existing branch, but not from creating a NEW branch
-- with it already on. Verified against production in a rolled-back transaction:
--
--   set local role authenticated;  -- a real owner's own uid
--   insert into hms_hostels (owner_id, name, total_capacity, whatsapp_enabled)
--     values (<their own id>, 'probe', 1, true);          -> INSERT 0 1
--
-- That is the PKR 8,000 feature set taken for free, and it lets a branch we
-- never approved start sending on the shared WABA — the same number every
-- client's rent reminders go out on.
--
-- The app itself is not at fault: whatsapp_enabled DEFAULTs to false, only
-- setWhatsAppEnabled (app/actions/super-admin.ts:367) ever writes it, and
-- createBranch never sets it. The gap is that "Owner manages own hostel" is
-- FOR ALL, so RLS must permit owner INSERTs for createBranch to work at all —
-- and an owner can POST to the REST API directly with fields the UI never offers.
--
-- MECHANISM, and the trap in it: the original guard keys on
-- `auth.uid() IS NOT NULL`, NOT on hms_is_super_admin(). The effective rule is
-- "service-role only", which is why setWhatsAppEnabled works — it uses
-- createAdminClient(), where auth.uid() is null. Rewriting this to call
-- hms_is_super_admin() would look more correct and would BREAK provisioning:
-- under service_role auth.uid() is null, that function returns false, and every
-- Super Admin write would start failing. The same test is therefore kept
-- verbatim.
--
-- TG_OP branching is required, not stylistic: OLD is unassigned in a BEFORE
-- INSERT trigger, so the original body's `NEW.x IS DISTINCT FROM OLD.x` cannot
-- simply be pointed at INSERT.
--
-- Not a breaking change. Proven by the matrix in the dry run:
--   owner INSERT whatsapp_enabled=true   -> blocked   (the fix)
--   owner INSERT default false           -> allowed   (createBranch unaffected)
--   owner UPDATE whatsapp_enabled        -> blocked   (unchanged)
--   owner UPDATE name                    -> allowed   (renameBranch unaffected)
--   service_role INSERT true             -> allowed   (provisioning unaffected)
--   service_role UPDATE                  -> allowed   (setWhatsAppEnabled unaffected)
-- Existing rows are untouched; a BEFORE trigger only sees new writes.

create or replace function public.hms_prevent_whatsapp_self_grant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Only a row arriving already enabled is refused. A normal owner-created
    -- branch inserts the column's default of false and passes untouched.
    IF NEW.whatsapp_enabled AND auth.uid() IS NOT NULL THEN
      RAISE EXCEPTION 'Forbidden: whatsapp_enabled can only be set by Super Admin';
    END IF;
  ELSE
    IF NEW.whatsapp_enabled IS DISTINCT FROM OLD.whatsapp_enabled AND auth.uid() IS NOT NULL THEN
      RAISE EXCEPTION 'Forbidden: whatsapp_enabled can only be changed by Super Admin';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

drop trigger if exists hms_block_whatsapp_self_grant on public.hms_hostels;
create trigger hms_block_whatsapp_self_grant
  before insert or update on public.hms_hostels
  for each row execute function public.hms_prevent_whatsapp_self_grant();
