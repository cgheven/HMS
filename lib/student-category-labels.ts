import type { StudentCategory } from "@/types";

export const STUDENT_CATEGORY_LABELS: Record<StudentCategory, string> = {
  college: "College",
  university: "University",
  test_preparation: "Exam Prep",
  professional_course: "Professional Course",
  skills_training: "Skills Training",
};

export const STUDENT_CATEGORY_OPTIONS: StudentCategory[] = [
  "college", "university", "test_preparation", "professional_course", "skills_training",
];

// University and College both have too many program+institution combinations
// for a fixed list — those two categories keep using the existing free-text
// Institute Name + Department/Field fields instead of a preset dropdown.
export function studentCategoryHasDepartment(category: StudentCategory | ""): boolean {
  return category === "university" || category === "college";
}

// The other 3 categories get a preset "Specialization" dropdown (with a
// custom/"Other" escape hatch) instead of Department/Field — a specific exam,
// certification, or skill is the meaningful matching signal there, not a
// department. Value stored is plain text (either the picked preset or
// whatever the user typed under "Other"), so the list below is a UI
// convenience, not a DB constraint.
export const STUDENT_SPECIALIZATION_PRESETS: Record<Exclude<StudentCategory, "university" | "college">, string[]> = {
  test_preparation: [
    "CSS — Central Superior Services",
    "IELTS — English Proficiency",
    "TOEFL — English Proficiency",
    "PTE — English Proficiency",
    "Spoken English",
    "OET — Occupational English Test",
    "NCLEX — Nursing Licensure Exam (USA)",
    "NRE I — Nursing Registration Exam, Part 1",
    "NRE II — Nursing Registration Exam, Part 2",
    "MDCAT — Medical College Admission",
    "ECAT — Engineering College Admission",
    "NAT — NTS Admission Test",
    "GAT — Graduate Admission Test",
    "SAT — International University Admission",
    "GRE — Graduate Studies Abroad",
  ],
  professional_course: [
    "ACCA — Accounting and Finance",
    "CFA — Chartered Financial Analyst",
    "CPA — Certified Public Accountant",
    "PMP — Project Management Professional",
    "CIMA — Management Accounting",
    "CIA — Certified Internal Auditor",
    "CISSP — Cybersecurity",
    "AWS Certification — Cloud Computing",
    "Google Analytics Certification",
    "Digital Marketing Certification",
  ],
  skills_training: [
    "Web Development — HTML CSS JavaScript",
    "Graphic Design — Canva Adobe",
    "Video Editing — Premiere Pro CapCut",
    "Mobile App Development",
    "Electrician Training",
    "Plumbing and Pipefitting",
    "Auto Mechanics",
    "Cooking and Culinary Arts",
    "Tailoring and Fashion Design",
    "English Speaking Course",
  ],
};

export function studentCategoryHasSpecialization(category: StudentCategory | ""): category is Exclude<StudentCategory, "university" | "college"> {
  return category === "test_preparation" || category === "professional_course" || category === "skills_training";
}

// Preset lists for the Institute Name dropdown, split by category so a
// Student picking "University" only sees universities and one picking
// "College" only sees colleges — easier to find the right name quickly.
// Value stored is plain text, same as Specialization — these lists are a UI
// convenience, not a DB constraint, and "Other" always covers anything
// missing.
const UNIVERSITY_INSTITUTE_PRESETS: string[] = [
  // Lahore
  "University of the Punjab (PU)",
  "Lahore University of Management Sciences (LUMS)",
  "University of Management and Technology (UMT)",
  "University of Central Punjab (UCP)",
  "University of Engineering and Technology (UET), Lahore",
  "King Edward Medical University (KEMU)",
  "Government College University (GCU), Lahore",
  "Forman Christian College (A Chartered University), Lahore",
  "Lahore School of Economics (LSE)",
  "Beaconhouse National University (BNU)",
  "National College of Arts (NCA)",
  "University of Health Sciences (UHS), Lahore",
  "COMSATS University Islamabad, Lahore Campus",
  "University of Lahore (UOL)",
  "Superior University, Lahore",
  "Minhaj University Lahore (MUL)",
  "University of South Asia (USA)",
  "Lahore Garrison University",
  "National University of Computer and Emerging Sciences (FAST), Lahore",
  "Lahore College for Women University (LCWU)",
  "Hajvery University",
  "University of Veterinary and Animal Sciences (UVAS), Lahore",
  "University of Education (UE), Lahore",
  "National University of Modern Languages (NUML), Lahore Campus",
  "Virtual University of Pakistan",
  "Government College Women University, Lahore",
  "Institute of Management Sciences, Lahore (IMS)",
  "Times Institute, Lahore",
  "Lahore Leads University",
  "Shalamar Medical and Dental College",
  "Central Park Medical College",
  "CMH Lahore Medical College",
  "Rashid Latif Medical College",
  "Akhtar Saeed Medical and Dental College",
  "Services Institute of Medical Sciences",
  "Fatima Memorial Hospital College of Medicine and Dentistry",
  "Ameeruddin Medical College",
  "Sharif Medical and Dental College",
  "Al-Aleem Medical College",
  "Imperial College of Business Studies",
  // Islamabad / Rawalpindi
  "Quaid-i-Azam University",
  "National University of Sciences and Technology (NUST)",
  "COMSATS University Islamabad",
  "International Islamic University, Islamabad (IIUI)",
  "Air University, Islamabad",
  "Riphah International University",
  "Foundation University, Islamabad",
  "Bahria University, Islamabad Campus",
  "National University of Modern Languages (NUML), Islamabad",
  "Allama Iqbal Open University (AIOU)",
  "Iqra University, Islamabad Campus",
  "Shifa Tameer-e-Millat University",
  "Capital University of Science and Technology (CUST)",
  "Federal Urdu University of Arts, Science and Technology, Islamabad",
  "Pakistan Institute of Engineering and Applied Sciences (PIEAS)",
  "National Defence University (NDU)",
  "Preston University, Islamabad",
  "Pir Mehr Ali Shah Arid Agriculture University, Rawalpindi",
  "Fatima Jinnah Women University, Rawalpindi",
  "Rawalpindi Medical University (RMU)",
  "University of Wah",
  "HITEC University, Taxila",
  "SZABIST, Islamabad Campus",
  "National Skills University, Islamabad",
];

const COLLEGE_INSTITUTE_PRESETS: string[] = [
  // Lahore
  "Government College Lahore (GCL)",
  "Kinnaird College for Women, Lahore",
  "Islamia College, Civil Lines, Lahore",
  "Government College for Women, Wahdat Road, Lahore",
  "Government College for Women, Jail Road, Lahore",
  "Government Post Graduate College for Women, Samanabad, Lahore",
  "Dayal Singh College, Lahore",
  "Punjab College, Lahore",
  "Superior College, Lahore",
  "Government College of Commerce, Lahore",
  "Aitchison College, Lahore",
  "Punjab Group of Colleges, Lahore",
  "Government Islamia College, Railway Road, Lahore",
  "Government M.A.O. College, Lahore",
  "Queen Mary College, Lahore",
  "Central Model School and College, Lahore",
  "Divisional Public School and College, Lahore",
  "Government College for Boys, Gulberg, Lahore",
  "Government Degree College, Township, Lahore",
  "Lahore College of Arts and Sciences",
  "Roots College International, Lahore",
  "Unique Group of Institutions, Lahore",
  "KIPS College, Lahore",
  "ILM College, Lahore",
  "Garrison College for Boys, Lahore",
  // Islamabad / Rawalpindi
  "F.G. College for Men, Islamabad",
  "F.G. College for Women, Islamabad",
  "Islamabad College for Boys",
  "Islamabad Model College for Girls",
  "Islamabad Model College for Boys",
  "F.G. Sir Syed College, Rawalpindi",
  "Army Public College of Management Sciences, Rawalpindi",
  "Government Gordon College, Rawalpindi",
  "Government College Asghar Mall, Rawalpindi",
  "Government College for Women, Satellite Town, Rawalpindi",
  "Punjab College, Islamabad",
  "Superior College, Islamabad",
  "Roots College International, Islamabad",
  "Unique Group of Institutions, Islamabad",
  "KIPS College, Islamabad",
  "Cadet College Hasan Abdal",
];

// Well-known Lahore/Islamabad coaching academies for CSS, IELTS, and other
// competitive-exam preparation. Confidence here is lower than the
// university/college lists — this space has many small, local coaching
// centers with less standardized names, so treat this as a starting point
// and correct/expand it as needed. "Other" always covers anything missing.
const TEST_PREPARATION_INSTITUTE_PRESETS: string[] = [
  "Future Learning Center",
  "Kips",
  "Dogar Brothers Academy",
  "CSS Forum Academy",
  "The CSS Point",
  "British Council",
  "Aspire Institute",
  "IELTS Ghar",
  "National Academy (CSS/PMS Preparation)",
  "Superior Test Preparation",
  "Read and Write IELTS Center",
  "USEFP (Educational Advising for GRE/SAT/US Admissions)",
  "The Knowledge House",
  "PARS Test Preparation",
];

// Well-known Lahore/Islamabad providers for accounting/finance/project-
// management style professional certifications (ACCA, CFA, PMP, etc.).
// Confidence here is lower than the university/college lists — correct/
// expand as needed. "Other" always covers anything missing.
const PROFESSIONAL_COURSE_INSTITUTE_PRESETS: string[] = [
  "Skans School of Accountancy",
  "Professional Academy of Commerce (PAC)",
  "Hyperion Education",
  "Kaplan Financial",
  "Institute of Chartered Accountants of Pakistan (ICAP)",
  "Pakistan Institute of Public Finance Accountants (PIPFA)",
  "Institute of Bankers Pakistan (IBP)",
  "Superior College of Commerce (ACCA Wing)",
  "Al-Hijaz Consulting",
  "Knowledge Training Center (KTC)",
];

// Well-known Lahore/Islamabad vocational/skills training providers (IT,
// design, trades, culinary, etc.). Confidence here is lower than the
// university/college lists — correct/expand as needed. "Other" always
// covers anything missing.
const SKILLS_TRAINING_INSTITUTE_PRESETS: string[] = [
  "TEVTA (Technical Education and Vocational Training Authority, Punjab)",
  "NAVTTC (National Vocational and Technical Training Commission)",
  "PVTC (Punjab Vocational Training Council)",
  "Aptech Learning",
  "Arena Animation",
  "Saylani Mass IT Training (SMIT)",
  "DigiSkills.pk (Punjab IT Board)",
  "Hunar Foundation",
  "Pakistan Institute of Fashion Design (PIFD)",
  "Pakistan Institute of Hotel Management (PIHM)",
  "Descon Institute of Technology",
  "Punjab Skills Development Fund (PSDF)",
];

export const INSTITUTE_PRESETS_BY_CATEGORY: Record<StudentCategory, string[]> = {
  university: UNIVERSITY_INSTITUTE_PRESETS,
  college: COLLEGE_INSTITUTE_PRESETS,
  test_preparation: TEST_PREPARATION_INSTITUTE_PRESETS,
  professional_course: PROFESSIONAL_COURSE_INSTITUTE_PRESETS,
  skills_training: SKILLS_TRAINING_INSTITUTE_PRESETS,
};

// Every category now has a curated preset list — this only returns false for
// the "no category chosen yet" ("") case, where Institute Name falls back to
// a plain free-text field until a category (and thus a preset list) exists.
export function studentCategoryHasInstitutePresets(category: StudentCategory | ""): category is StudentCategory {
  return category !== "";
}

// Academic departments for University/College students. Free text is still what
// gets stored — this is a browsing convenience with an "Other (specify)" escape
// hatch, exactly like INSTITUTE_PRESETS_BY_CATEGORY. Deliberately NOT used for
// Professionals: their "department" means a workplace function (HR, Finance,
// Operations), which is a different vocabulary, so that stays a free-text field.
//
// Ordered by how common each is in hostel intake rather than alphabetically —
// the list is searchable, so the first screen should show the likeliest picks.
export const DEPARTMENT_PRESETS: string[] = [
  // Computing
  "Computer Science",
  "Software Engineering",
  "Information Technology",
  "Artificial Intelligence",
  "Data Science",
  "Cyber Security",
  // Engineering
  "Electrical Engineering",
  "Mechanical Engineering",
  "Civil Engineering",
  "Chemical Engineering",
  "Electronics Engineering",
  "Mechatronics Engineering",
  "Telecommunication Engineering",
  "Biomedical Engineering",
  "Industrial Engineering",
  "Textile Engineering",
  "Aerospace / Aviation",
  "Architecture",
  // Medical & health
  "MBBS (Medicine)",
  "BDS (Dentistry)",
  "Pharmacy (Pharm-D)",
  "Nursing",
  "Physiotherapy (DPT)",
  "Medical Lab Technology",
  "Radiology & Imaging",
  "Human Nutrition & Dietetics",
  "Veterinary Sciences",
  // Business
  "Business Administration (BBA/MBA)",
  "Accounting & Finance",
  "Commerce (B.Com / M.Com)",
  "Banking & Finance",
  "Marketing",
  "Human Resource Management",
  "Supply Chain Management",
  "Economics",
  // Natural sciences
  "Mathematics",
  "Physics",
  "Chemistry",
  "Statistics",
  "Biotechnology",
  "Microbiology",
  "Biochemistry",
  "Botany",
  "Zoology",
  "Environmental Science",
  "Geology",
  "Agriculture",
  "Food Science & Technology",
  // Arts, social sciences & law
  "Law (LLB)",
  "English Literature",
  "Mass Communication / Media",
  "Psychology",
  "Sociology",
  "Political Science",
  "International Relations",
  "Education",
  "Islamic Studies",
  "History",
  "Urdu",
  "Fine Arts & Design",
  "Tourism & Hospitality",
  "Physical Education & Sports",
];

// Workplace departments for Professionals. A separate vocabulary from the
// academic list above — a professional's "department" is the function they work
// in (Finance, Operations) or their field of practice, not a degree programme.
// Same contract: plain text is stored, "Other (specify)" covers anything missing.
export const PROFESSIONAL_DEPARTMENT_PRESETS: string[] = [
  // Common corporate functions
  "Information Technology (IT)",
  "Software Development",
  "Sales",
  "Marketing",
  "Finance & Accounts",
  "Human Resources (HR)",
  "Operations",
  "Administration",
  "Customer Support",
  "Business Development",
  "Project Management",
  "Procurement & Supply Chain",
  "Logistics & Distribution",
  "Quality Assurance",
  "Research & Development (R&D)",
  "Data & Analytics",
  "Design & Creative",
  "Legal",
  "Audit",
  "Taxation",
  "Public Relations",
  "Training & Development",
  "Health & Safety (HSE)",
  "Maintenance",
  "Production & Manufacturing",
  "Security",
  // Sector-specific roles common in hostel intake
  "Medical / Clinical",
  "Nursing",
  "Pharmacy",
  "Teaching / Faculty",
  "Banking Operations",
  "Engineering (Field)",
  "Civil Works & Construction",
  "Telecom / Network Operations",
  "Agriculture Extension",
  "Journalism / Media",
  "Government / Civil Service",
  "Armed Forces",
  "Police / Law Enforcement",
  "Aviation",
  "Hospitality & Food Service",
  "Retail",
  "Transport & Driving",
  "Freelance / Self-employed",
];

// Which preset list a given tenant type should browse. Keeps the three forms
// (public application, Add Tenant, Approve Application) from each deciding for
// themselves and drifting apart.
export function departmentPresetsFor(type: string): string[] {
  return type === "professional" ? PROFESSIONAL_DEPARTMENT_PRESETS : DEPARTMENT_PRESETS;
}
