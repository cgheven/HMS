/**
 * Tiered, per-country SaaS pricing — the single source of truth for the non-PK
 * (Paddle / card) markets. Separate from the legacy per-branch invoice pricing in
 * lib/pricing.ts. See the project-tiered-country-pricing memory for the locked spec.
 *
 * Model: pricing is PROPERTY-COUNT TIERED (flat price per band), not per-property.
 *   - basic      = 1 property
 *   - standard   = up to 3 properties
 *   - business   = up to 10 properties
 *   - enterprise = 10+  (custom / "contact us" — no self-serve price)
 *
 * Adding properties WITHIN the current tier's cap costs nothing; crossing INTO a
 * higher tier prorates only the tier-price DIFFERENCE for the remaining period,
 * with the full new-tier price from the next renewal.
 *
 * Annual = monthly × 10 (pay for 10 months, get 12) in every market.
 *
 * Pakistan is EXCLUDED — it stays on its existing manual PKR bank-invoice billing
 * (manualBankBilling), never this tier system.
 *
 * Amounts are in MAJOR currency units (79 = £79.00). Paddle wants minor units —
 * use `toMinorUnits()` at the boundary. Every market currency here is 2-decimal.
 */

export type PricingTier = "basic" | "standard" | "business" | "enterprise";
export type TierBillingCycle = "monthly" | "annual";

export const SELF_SERVE_TIERS: Exclude<PricingTier, "enterprise">[] = ["basic", "standard", "business"];

/**
 * Pakistan card-rail price: a flat PER-BRANCH USD monthly rate (annual = ×10),
 * NOT the property-count tier bands above. Stored per-owner in
 * hms_profiles.custom_unit_amount_usd (the existing per-branch USD mechanism) and
 * charged as rate × billable branches at checkout. Applies only to owners with
 * hms_profiles.pk_card_enabled = true (new PK self-reg owners); existing PK clients
 * stay on manual bank invoicing.
 */
export const PK_CARD_MONTHLY_USD = 15;

/**
 * PK card-rail VOLUME pricing (new PK self-reg owners, pk_card_enabled). Charged
 * in USD via Paddle (Paddle cannot settle PKR); the PKR figure is a display-only
 * approximate reference. Per-branch rate drops as branch count grows; the total
 * is the flat band rate × branch count. 21+ branches is custom-quoted. This is
 * the self-serve schedule ONLY — manually-onboarded clients keep their negotiated
 * flat custom_unit_amount_usd and never touch these bands.
 */
export interface PkCardBand {
  /** Inclusive upper bound of branch count; null = the 21+ custom band. */
  maxBranches: number | null;
  /** Monthly USD per branch (the actual charge), or null when custom-quoted. */
  perBranchUsd: number | null;
  /** Approximate PKR reference for display only, or null when custom. */
  refPkr: number | null;
}

export const PK_CARD_BANDS: readonly PkCardBand[] = [
  { maxBranches: 1, perBranchUsd: 20, refPkr: 6000 },
  { maxBranches: 4, perBranchUsd: 18, refPkr: 5500 },
  { maxBranches: 8, perBranchUsd: 17, refPkr: 5000 },
  { maxBranches: 15, perBranchUsd: 15, refPkr: 4500 },
  { maxBranches: 20, perBranchUsd: 13, refPkr: 4000 },
  { maxBranches: null, perBranchUsd: null, refPkr: null }, // 21+ — custom
];

/** Monthly USD rate per branch for a branch count; null = custom-quote (21+). */
export function pkCardPerBranchUsd(branchCount: number): number | null {
  const n = Math.max(1, Math.round(branchCount) || 1);
  for (const b of PK_CARD_BANDS) {
    if (b.maxBranches === null || n <= b.maxBranches) return b.perBranchUsd;
  }
  return null;
}

/**
 * Total monthly USD for a PK card-rail owner's branch count, clamped to a running
 * max so the total never DECREASES as branches grow (a cheaper band must never
 * undercut what a smaller setup already pays). null = custom-quote (21+).
 */
export function pkCardMonthlyUsd(branchCount: number): number | null {
  const n = Math.max(1, Math.round(branchCount) || 1);
  if (pkCardPerBranchUsd(n) === null) return null;
  let total = 0;
  for (let k = 1; k <= n; k++) {
    const rate = pkCardPerBranchUsd(k);
    if (rate !== null) total = Math.max(total, k * rate);
  }
  return total;
}

/**
 * Monthly USD total to charge a per-branch (custom-rate) owner: the PK card VOLUME
 * schedule when pkCard is true, else the legacy FLAT rate × branch count. null
 * means a pk_card owner has hit the 21+ custom band (no self-serve amount).
 */
export function customRateMonthlyUsd(
  pkCard: boolean,
  customMonthlyUsd: number | null | undefined,
  branchCount: number
): number | null {
  const n = Math.max(1, Math.round(branchCount) || 1);
  if (pkCard) return pkCardMonthlyUsd(n);
  const flat = Number(customMonthlyUsd);
  return flat > 0 ? flat * n : null;
}

/** Inclusive upper bound on property count for each self-serve tier. */
export const TIER_PROPERTY_CAP: Record<Exclude<PricingTier, "enterprise">, number> = {
  basic: 1,
  standard: 3,
  business: 10,
};

export const TIER_LABEL: Record<PricingTier, string> = {
  basic: "Basic",
  standard: "Standard",
  business: "Business",
  enterprise: "Enterprise",
};

/** "What you get" line for the plan cards. */
export const TIER_PROPERTIES_LABEL: Record<PricingTier, string> = {
  basic: "1 property",
  standard: "Up to 3 properties",
  business: "Up to 10 properties",
  enterprise: "10+ properties",
};

/** The tier an owner belongs on for a given billable-property count. */
export function tierForPropertyCount(count: number): PricingTier {
  const n = Math.max(1, Math.floor(count || 1));
  if (n <= TIER_PROPERTY_CAP.basic) return "basic";
  if (n <= TIER_PROPERTY_CAP.standard) return "standard";
  if (n <= TIER_PROPERTY_CAP.business) return "business";
  return "enterprise";
}

export interface MarketPricing {
  /** ISO 4217 currency the market is charged in. */
  currency: string;
  /** MONTHLY amount in major units. Enterprise is custom (no amount). */
  basic: number;
  standard: number;
  business: number;
}

/**
 * Explicit per-market monthly pricing. Keys are pricing-market ids (an ISO country
 * code, or a USD pseudo-market). Country → market is `marketForCountry()`.
 */
export const MARKET_PRICING: Record<string, MarketPricing> = {
  GB: { currency: "GBP", basic: 79, standard: 149, business: 249 },
  IE: { currency: "EUR", basic: 79, standard: 149, business: 249 },
  AE: { currency: "AED", basic: 299, standard: 599, business: 999 },
  SA: { currency: "SAR", basic: 399, standard: 799, business: 1499 },
  IN: { currency: "INR", basic: 3999, standard: 7999, business: 14999 },
  AU: { currency: "AUD", basic: 99, standard: 179, business: 299 },
  CA: { currency: "CAD", basic: 79, standard: 149, business: 249 },
  NZ: { currency: "NZD", basic: 99, standard: 189, business: 299 },
  SG: { currency: "SGD", basic: 99, standard: 199, business: 329 },
  MY: { currency: "MYR", basic: 149, standard: 299, business: 499 },
  ZA: { currency: "ZAR", basic: 799, standard: 1499, business: 2499 },
  // Lower-cost USD group.
  DEV_USD: { currency: "USD", basic: 29, standard: 49, business: 79 },
  // Default for every unlisted country — USD, never auto-converted to local.
  DEFAULT_USD: { currency: "USD", basic: 79, standard: 149, business: 249 },
};

/** Countries billed under the lower-cost DEV_USD group. */
const DEV_USD_COUNTRIES = new Set(["BD", "NP", "PH"]);

/**
 * Resolve a country to its pricing-market id. Pakistan is not priced here (manual
 * billing); callers must gate PK out first. Unlisted countries fall back to
 * DEFAULT_USD (charged in USD, by design — no local-currency conversion).
 */
export function marketForCountry(country: string | null | undefined): string {
  const code = (country ?? "").trim().toUpperCase();
  if (code && MARKET_PRICING[code]) return code;
  if (DEV_USD_COUNTRIES.has(code)) return "DEV_USD";
  return "DEFAULT_USD";
}

export interface ResolvedTierPrice {
  tier: PricingTier;
  cycle: TierBillingCycle;
  market: string;
  currency: string;
  /** Amount in MAJOR units for the chosen cycle (annual = monthly × 10). */
  amount: number;
  /** True when the tier is custom-quoted (Enterprise) — no self-serve amount. */
  custom: boolean;
}

/** Price for a country + tier + cycle. Enterprise returns custom:true, amount 0. */
export function priceFor(
  country: string | null | undefined,
  tier: PricingTier,
  cycle: TierBillingCycle
): ResolvedTierPrice {
  const market = marketForCountry(country);
  const m = MARKET_PRICING[market];
  if (tier === "enterprise") {
    return { tier, cycle, market, currency: m.currency, amount: 0, custom: true };
  }
  const monthly = m[tier];
  const amount = cycle === "annual" ? monthly * 10 : monthly;
  return { tier, cycle, market, currency: m.currency, amount, custom: false };
}

/** Full price for the tier an owner's property count puts them on. */
export function priceForPropertyCount(
  country: string | null | undefined,
  count: number,
  cycle: TierBillingCycle
): ResolvedTierPrice {
  return priceFor(country, tierForPropertyCount(count), cycle);
}

/** Paddle wants integer minor units. Every market currency here is 2-decimal. */
export function toMinorUnits(majorAmount: number): number {
  return Math.round(majorAmount * 100);
}
