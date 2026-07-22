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

// STANDARD_CLIENT_MONTHLY_RATE is our fixed "full price" reference — every
// client's actual hms_client_billing.monthly_rate is compared against it to
// auto-derive their discount %, for both monthly and annual clients alike.
// There's no separate manually-set discount lever; the rate itself is the only
// lever, same as ONBOARDING_FEE (a fixed amount — only charged-or-waived varies).
export const STANDARD_CLIENT_MONTHLY_RATE = 8000;
export const ONBOARDING_FEE = 10000;

export type BillingCycle = "monthly" | "annual";

/** Auto-derived discount %, clamped to 0 so a rate at/above standard never shows a negative discount. */
export function clientDiscountPct(monthlyRate: number): number {
  if (STANDARD_CLIENT_MONTHLY_RATE <= 0) return 0;
  return Math.max(0, ((STANDARD_CLIENT_MONTHLY_RATE - monthlyRate) / STANDARD_CLIENT_MONTHLY_RATE) * 100);
}

/** Inverts a snapshotted (actualSubtotal, discountPct) pair back to the list-price
 * subtotal it was derived from — exact since discountPct was computed from this
 * same actualSubtotal at generation time (see lib/invoice-generation.ts). Used for
 * display only; the stored discount_pct/monthly_rate remain the source of truth. */
export function listSubtotalFromDiscount(actualSubtotal: number, discountPct: number): number {
  if (discountPct <= 0) return actualSubtotal;
  return actualSubtotal / (1 - discountPct / 100);
}

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
