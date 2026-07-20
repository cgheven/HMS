// Shared with app/onboarding/onboarding-client.tsx (live preview) and
// app/actions/onboarding.ts (authoritative quote) so the two never drift.
export const MONTHLY_RATE_PER_BRANCH = 8000;
export const ANNUAL_RATE_PER_BRANCH = 80000; // = 10 months × monthly rate (2 months free)

export function calculateAnnualPrice(branchCount: number): number {
  const branches = Math.max(1, Math.round(branchCount) || 1);
  return branches * ANNUAL_RATE_PER_BRANCH;
}

export function calculateMonthlyPrice(branchCount: number): number {
  const branches = Math.max(1, Math.round(branchCount) || 1);
  return branches * MONTHLY_RATE_PER_BRANCH;
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
