-- Sales rep emails are now a live follow-up-digest send target (lib/email.ts
-- sendGroupedFollowUpDigests), not just a login identifier — tighten the CHECK
-- to match lib/validation.ts's EMAIL_RE, excluding "," and ";" so a single
-- email field can never be smuggled in as a multi-address recipient list.
ALTER TABLE hms_sales_reps DROP CONSTRAINT IF EXISTS hms_sales_reps_email_check;
ALTER TABLE hms_sales_reps ADD CONSTRAINT hms_sales_reps_email_check
  CHECK (email ~ '^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$');
