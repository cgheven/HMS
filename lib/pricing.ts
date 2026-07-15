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

// ── Platform invoicing (Pulse billing hostel-owner clients) ──────────────────
// Custom-priced per client (some are legacy/discounted), on either cycle —
// see hms_client_billing. This is separate from the public onboarding quote above.

export type BillingCycle = "monthly" | "annual";

export function computeInvoicePeriod(cycle: BillingCycle, anchor: Date) {
  const start = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate()));
  const end =
    cycle === "monthly"
      ? new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, start.getUTCDate()))
      : new Date(Date.UTC(start.getUTCFullYear() + 1, start.getUTCMonth(), start.getUTCDate()));
  const label =
    cycle === "monthly"
      ? start.toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })
      : String(start.getUTCFullYear());

  return {
    periodStart: start.toISOString().slice(0, 10),
    periodEnd: end.toISOString().slice(0, 10),
    label,
  };
}
