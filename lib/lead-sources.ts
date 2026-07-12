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
] as const;

export const LEAD_SOURCE_OTHER = "Other";
