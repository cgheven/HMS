-- Split the combined "University / College Student" category into two
-- separate categories — University and College are different types of
-- institutions. Safe to redefine outright: confirmed zero tenants/
-- applications have any student_category value set yet (no real adoption
-- since migration 128 shipped).
--
-- New categories (5, replacing the old 4):
--   university            - University Student
--   college               - College Student
--   test_preparation      - (unchanged)
--   professional_course   - (unchanged)
--   skills_training       - (unchanged)

ALTER TABLE hms_tenants DROP CONSTRAINT IF EXISTS hms_tenants_student_category_check;
ALTER TABLE hms_tenants
  ADD CONSTRAINT hms_tenants_student_category_check
    CHECK (student_category IS NULL OR student_category IN ('university', 'college', 'test_preparation', 'professional_course', 'skills_training'));

ALTER TABLE hms_tenant_applications DROP CONSTRAINT IF EXISTS hms_tenant_applications_student_category_check;
ALTER TABLE hms_tenant_applications
  ADD CONSTRAINT hms_tenant_applications_student_category_check
    CHECK (student_category IS NULL OR student_category IN ('university', 'college', 'test_preparation', 'professional_course', 'skills_training'));
