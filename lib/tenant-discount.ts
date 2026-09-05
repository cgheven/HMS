// Standing rent discounts (migration 211). The percentage is stored on the
// tenant and the rupees are derived by hms_recalculate_payment_amount, so the
// two things that must never drift are duplicated here on purpose: the rounding
// the trigger uses, and the range its CHECK constraint enforces.

/** Mirrors the trigger's round(rent * pct / 100), so the effective rent shown
 *  while typing is the one that will actually be billed. */
export function discountedRent(rent: number, percent: number): number {
  return rent - Math.round((rent * percent) / 100);
}

/** Null means no concession. Anything else must be a number in 0..100 — the
 *  range hms_tenants_discount_percent_range enforces, checked here first so a
 *  bad value comes back as a sentence rather than a Postgres constraint dump. */
export function validateDiscountPercent(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
    return "Discount must be a percentage between 0 and 100.";
  }
  return null;
}
