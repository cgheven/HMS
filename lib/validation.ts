// Shared email format validator — used wherever an email is captured for a
// sales rep or a lead, so app-level validation and the DB CHECK constraint stay aligned.
// Sales rep emails are now a live send target (follow-up digests), not just a
// login identifier — excluding "," and ";" blocks a single field from being
// smuggled in as a multi-address recipient list.
export const EMAIL_RE = /^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/;

// Digits-only phone, matching the hms_sales_reps / hms_managers DB CHECK constraints.
export const PHONE_RE = /^\d{7,15}$/;

// Property-type presets offered at signup. "Other" reveals a free-text field, so
// the stored value is either one of these presets or arbitrary (length-capped)
// custom text — there is no DB CHECK by design. Shared by the client form and the
// server whitelist so the two never drift.
export const PROPERTY_TYPES = [
  "Hostel",
  "Guest House",
  "Student Accommodation",
  "Hotel",
  "Co-living",
  "HMO / Shared Accommodation",
  "Boarding House",
  "Other",
] as const;

// Accommodation type — "who can live here". Stored in hms_hostels.hostel_type
// (canonical values boys/girls/mixed, migration 246); labels are gender-neutral
// for international markets.
export const ACCOMMODATION_TYPES = [
  { value: "boys", label: "Male Only" },
  { value: "girls", label: "Female Only" },
  { value: "mixed", label: "Mixed" },
] as const;

export const ACCOMMODATION_TYPE_VALUES = ["boys", "girls", "mixed"] as const;

export const PROPERTY_TYPE_MAX_LEN = 60;

// Max properties (branches) an owner may hold.
export const MAX_PROPERTIES = 20;
