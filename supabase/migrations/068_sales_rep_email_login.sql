-- Switch sales-rep portal login from phone/synthetic-email (@hms-sales.internal)
-- to a real email address — sales staff are expected to have their own email,
-- so there's no need for the phone-based synthetic-account workaround used for
-- managers. Phone becomes an optional contact field only.

ALTER TABLE hms_sales_reps
  ADD COLUMN email TEXT UNIQUE CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');

ALTER TABLE hms_sales_reps
  ALTER COLUMN phone DROP NOT NULL;
