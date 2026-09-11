/**
 * Country configuration registry — the single place that turns a country code
 * into everything Pulse needs to behave correctly for that country: currency,
 * locale, timezone, phone dial code, national-ID rule, and (added as later
 * phases need them) payment rails, verification integration, message language.
 *
 * This is the keystone of the multi-country design. Every central primitive
 * (currency formatting, phone normalization, "today" in the owner's zone, ID
 * validation) resolves the owner/hostel's `country` through here instead of
 * hardcoding Pakistan. Onboarding a new country = adding a row below, not a code
 * change scattered across the app.
 *
 * Pakistan's values are deliberately set to EXACTLY the current hardcodes
 * (PKR / en-PK / Asia/Karachi / +92 / CNIC), so wiring a primitive to read from
 * this registry is a verified no-op for every existing (PK) client.
 *
 * Static, non-secret config — safe to import from server and client alike.
 */

export type CountryCode = string; // ISO 3166-1 alpha-2, uppercase (e.g. "PK", "BD")

export interface NationalIdRule {
  /** What the ID is called in this country, shown as the field label. */
  label: string;
  /** Human example shown as placeholder / in errors. */
  example?: string;
}

export interface CountryConfig {
  /** ISO 3166-1 alpha-2, uppercase. */
  code: CountryCode;
  /** Display name. */
  name: string;
  /** ISO 4217 currency code, e.g. "PKR". */
  currency: string;
  /** Short currency symbol used in dense UI / receipts, e.g. "Rs", "৳". */
  currencySymbol: string;
  /** BCP-47 locale for number/date formatting, e.g. "en-PK". */
  locale: string;
  /** IANA timezone, e.g. "Asia/Karachi". Drives every "today" / freeze / bill date. */
  timezone: string;
  /** International dialing code without "+", e.g. "92". */
  dialCode: string;
  /** National identity document rule (CNIC in PK, NID in BD, …). */
  nationalId: NationalIdRule;
}

export const DEFAULT_COUNTRY: CountryCode = "PK";

export const COUNTRY_CONFIG: Record<CountryCode, CountryConfig> = {
  PK: {
    code: "PK",
    name: "Pakistan",
    currency: "PKR",
    currencySymbol: "Rs",
    locale: "en-PK",
    timezone: "Asia/Karachi",
    dialCode: "92",
    nationalId: { label: "CNIC", example: "42101-1234567-1" },
  },
  // Future countries plug in here — e.g. BD (Bangladesh, BDT, ৳, Asia/Dhaka, 880,
  // NID). Left out until the primitives that consume this registry are wired up,
  // so we never advertise a country the app can't yet fully serve.
};

/**
 * Resolve a country code to its config. Unknown / null / legacy values fall back
 * to the default (Pakistan) so no caller can ever get `undefined` and every
 * pre-keystone row keeps behaving exactly as before.
 */
export function getCountryConfig(code: string | null | undefined): CountryConfig {
  const key = (code ?? "").trim().toUpperCase();
  return COUNTRY_CONFIG[key] ?? COUNTRY_CONFIG[DEFAULT_COUNTRY];
}

/** True when `code` is a country the app is configured to fully serve. */
export function isSupportedCountry(code: string | null | undefined): boolean {
  return !!code && Object.prototype.hasOwnProperty.call(COUNTRY_CONFIG, code.trim().toUpperCase());
}
