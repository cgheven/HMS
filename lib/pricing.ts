// Shared with app/onboarding/onboarding-client.tsx (live preview) and
// app/actions/onboarding.ts (authoritative quote) so the two never drift.
const STANDARD_RATE = 60000;
const DISCOUNT_RATE = 36000;
const DISCOUNT_STARTS_AT_BRANCH = 10;

export function calculateAnnualPrice(branchCount: number): number {
  const branches = Math.max(1, Math.round(branchCount) || 1);
  const standardBranches = Math.min(branches, DISCOUNT_STARTS_AT_BRANCH - 1);
  const discountedBranches = Math.max(0, branches - (DISCOUNT_STARTS_AT_BRANCH - 1));
  return standardBranches * STANDARD_RATE + discountedBranches * DISCOUNT_RATE;
}
