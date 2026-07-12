// Shared email format validator — used wherever an email is captured for a
// sales rep or a lead, so app-level validation and the DB CHECK constraint stay aligned.
export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Digits-only phone, matching the hms_sales_reps / hms_managers DB CHECK constraints.
export const PHONE_RE = /^\d{7,15}$/;
