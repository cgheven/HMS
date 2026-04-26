-- HMS Admin Migration
-- Run this AFTER 001_hms_schema.sql

-- Add is_admin flag to profiles
alter table hms_profiles
  add column if not exists is_admin boolean default false not null;

-- Admin can read ALL profiles (for user management panel)
create policy "Admin reads all profiles"
  on hms_profiles for select
  using (
    auth.uid() = id
    or exists (
      select 1 from hms_profiles p
      where p.id = auth.uid() and p.is_admin = true
    )
  );

-- Drop the old select policy first (it conflicts)
drop policy if exists "Users see own profile" on hms_profiles;

-- Re-create scoped select: own row OR admin
-- (policy above already handles both cases)

-- Grant admin to your account — replace with your actual user UUID from Supabase Auth dashboard
-- UPDATE hms_profiles SET is_admin = true WHERE email = 'your-email@example.com';

-- Alternatively run this after finding your UUID:
-- UPDATE hms_profiles SET is_admin = true WHERE id = 'your-uuid-here';
