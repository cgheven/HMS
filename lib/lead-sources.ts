// Shared preset list for the lead "Source" field — used by both the SuperAdmin
// Add Lead dialog and the Sales portal's New Lead dialog, so the options never drift.
export const LEAD_SOURCES = [
  "Cold Call",
  "Walk-in",
  "Referral",
  "Instagram",
  "Facebook",
  "Google",
  "WhatsApp",
  "Website",
  "Book a Demo",
] as const;

export const LEAD_SOURCE_OTHER = "Other";

// The exact source value stamped on leads from the public /book-demo form, so the
// super-admin/sales board can filter them as a first-class source (it's in the
// preset list above). Keep these two in sync.
export const DEMO_LEAD_SOURCE = "Book a Demo";
