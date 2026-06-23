-- Migration 026: Bootstrap the platform super admin account
-- Runs as postgres superuser so we disable the role-escalation guard temporarily,
-- promote the account, then re-enable the guard immediately.

DO $$
BEGIN
  -- Disable the anti-escalation trigger for this session only
  ALTER TABLE hms_profiles DISABLE TRIGGER hms_prevent_role_self_escalation;

  -- Promote the super admin account (email hard-coded for bootstrap)
  UPDATE hms_profiles
  SET role = 'super_admin'
  WHERE email = 'admin@yourpulse.io';

  -- Re-enable the trigger immediately after
  ALTER TABLE hms_profiles ENABLE TRIGGER hms_prevent_role_self_escalation;
END;
$$;
