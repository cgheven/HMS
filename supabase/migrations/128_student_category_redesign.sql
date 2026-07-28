-- Redesign of the Student Category scheme shipped in migration 127 — the
-- client wants a broader, product-shaped categorization instead of the
-- narrower college/university/training_certification/ielts/css split.
-- Safe to redefine outright: confirmed zero tenants/applications have any
-- student_category value set yet (feature was only just shipped, no real
-- adoption yet).
--
-- New categories (4, replacing the old 5):
--   university_college    - University / College Student
--   test_preparation      - CSS, IELTS, TOEFL, MDCAT, ECAT, NAT, GAT, SAT, GRE, PTE...
--   professional_course   - ACCA, CFA, CPA, PMP, CIMA, CIA, CISSP, AWS, ...
--   skills_training       - Web Dev, Graphic Design, Electrician, Plumbing, ...
--
-- New field student_specialization: free text (no CHECK) — backs a dropdown
-- of common exams/courses/skills per category with a "custom" escape hatch,
-- so a client typing something not in the preset list is never blocked.
-- Only meaningful for test_preparation/professional_course/skills_training;
-- university_college keeps using the existing institute_name + department
-- free-text fields instead (too many program+institution combinations for a
-- fixed list).

ALTER TABLE hms_tenants DROP CONSTRAINT IF EXISTS hms_tenants_student_category_check;
ALTER TABLE hms_tenants
  ADD CONSTRAINT hms_tenants_student_category_check
    CHECK (student_category IS NULL OR student_category IN ('university_college', 'test_preparation', 'professional_course', 'skills_training'));
ALTER TABLE hms_tenants
  ADD COLUMN IF NOT EXISTS student_specialization text;

ALTER TABLE hms_tenant_applications DROP CONSTRAINT IF EXISTS hms_tenant_applications_student_category_check;
ALTER TABLE hms_tenant_applications
  ADD CONSTRAINT hms_tenant_applications_student_category_check
    CHECK (student_category IS NULL OR student_category IN ('university_college', 'test_preparation', 'professional_course', 'skills_training'));
ALTER TABLE hms_tenant_applications
  ADD COLUMN IF NOT EXISTS student_specialization text;
