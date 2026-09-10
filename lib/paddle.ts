import "server-only";

export type PlanKey = "basic" | "standard";
export type BillingCycle = "monthly" | "annual";

/** One-time onboarding fee in USD (≈ Rs 10,000 at the ~275 PKR/$ subscription
 *  rate). Charged once, as a one-time line item on the first card payment, for a
 *  manually-onboarded client who hasn't settled it (see hms_client_billing
 *  .onboarding_paid / .waive_onboarding). Self-onboarded clients are waived. */
export const ONBOARDING_FEE_USD = 36;

const PRICE_ENV: Record<PlanKey, Record<BillingCycle, string>> = {
  basic: { monthly: "PADDLE_PRICE_ID_BASIC_MONTHLY", annual: "PADDLE_PRICE_ID_BASIC_ANNUAL" },
  standard: { monthly: "PADDLE_PRICE_ID_STANDARD_MONTHLY", annual: "PADDLE_PRICE_ID_STANDARD_ANNUAL" },
};

/**
 * Server-side plan → Paddle price id. The checkout price is resolved HERE, from
 * a fixed enum, never from anything the client sends — so a caller cannot swap in
 * a cheaper/foreign price. Throws if unconfigured.
 */
export function getPlanPriceId(plan: PlanKey, cycle: BillingCycle): string {
  const id = process.env[PRICE_ENV[plan][cycle]];
  if (!id) throw new Error(`Paddle price not configured for ${plan}/${cycle}`);
  return id;
}

export type PaddleClientConfig = {
  environment: "sandbox" | "production";
  /** Public client-side token — safe in the browser. */
  clientToken: string;
  /** Price ids for the four plan/cycle combos — used only for localized price
   *  PREVIEW in the browser (display); the charge is set server-side. */
  prices: { basicMonthly: string; standardMonthly: string; basicAnnual: string; standardAnnual: string };
  /** Where the buyer is redirected to complete payment — a checkout page on an
   *  APPROVED domain (prod: https://yourpulse.io/checkout). Defaults to this
   *  app's own /checkout (fine on sandbox, where every domain is approved). */
  checkoutUrl: string;
};

export function getPaddleClientConfig(): PaddleClientConfig {
  return {
    environment: process.env.PADDLE_ENV === "production" ? "production" : "sandbox",
    clientToken: process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN ?? "",
    checkoutUrl: process.env.NEXT_PUBLIC_PADDLE_CHECKOUT_URL || "/checkout",
    prices: {
      basicMonthly: process.env.PADDLE_PRICE_ID_BASIC_MONTHLY ?? "",
      standardMonthly: process.env.PADDLE_PRICE_ID_STANDARD_MONTHLY ?? "",
      basicAnnual: process.env.PADDLE_PRICE_ID_BASIC_ANNUAL ?? "",
      standardAnnual: process.env.PADDLE_PRICE_ID_STANDARD_ANNUAL ?? "",
    },
  };
}
