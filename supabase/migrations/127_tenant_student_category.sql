-- Finer-grained student segregation for the future roommate-matching platform:
-- a lot of hostel residents are doing IELTS or CSS exam prep rather than
-- attending a formal college/university, so "Institute Name" alone loses
-- that signal. Purely additive/opt-in — every existing tenant and
-- application defaults to NULL, so nothing changes until an owner enables
-- this field (Settings) or a tenant is added/edited going forward.

ALTER TABLE hms_tenants
  ADD COLUMN IF NOT EXISTS student_category text
    CHECK (student_category IS NULL OR student_category IN ('college', 'university', 'training_certification', 'ielts', 'css'));

ALTER TABLE hms_tenant_applications
  ADD COLUMN IF NOT EXISTS student_category text
    CHECK (student_category IS NULL OR student_category IN ('college', 'university', 'training_certification', 'ielts', 'css'));
