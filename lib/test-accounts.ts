// Internal accounts that exist for testing, not real clients. They own real
// branches with real tenant rows, so leaving them in the Super Admin dashboard
// silently inflates every headline number — client count, outstanding balance,
// MRR — and makes the business look bigger than it is.
//
// A hardcoded list rather than an is_test column on hms_profiles: two rows do
// not justify a production schema change, and this is instantly revertible in
// a code deploy. If a third test account appears, that trade flips — add the
// column and a Super Admin toggle then.
//
// Owner-level, matching how the dashboard groups everything: excluding an owner
// excludes their branches, tenants, invoices and billing config together, so
// the figures stay internally consistent.
export const TEST_OWNER_IDS: readonly string[] = [
  "351a6611-f337-4cbc-bac8-0420ac6abebf", // Najam — najam@yourpulse.io
  "47be4018-8e39-47a5-973a-90a4f7a4d8e5", // Al Noor — musabkhan.queries@gmail.com
  "bbd1840a-a229-4002-884b-19178d4a17d4", // Tariq Boys Hostel — aamirsansi29@gmail.com (friend's account)
];

export function isTestOwner(ownerId: string | null | undefined): boolean {
  return !!ownerId && TEST_OWNER_IDS.includes(ownerId);
}
