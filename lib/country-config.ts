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
  /** Valid digit counts, ignoring separators (PK CNIC = [13]; BD NID = [10, 17]). */
  digitLengths: number[];
  /** Optional display grouping via dashes, e.g. PK [5,7,1] → 42101-1234567-1.
   *  Omitted → the digits are shown as typed. */
  groups?: number[];
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
  /** Whether tenants must be filed with a government guest-registration portal.
   *  When true, province + district are required on admission and the Hotel-Eye-
   *  style integration applies (Pakistan only today). When false, that geography
   *  is optional and the integration is hidden. GATE on this / isSupportedCountry,
   *  never on getCountryConfig().code (which fails open to PK). */
  guestRegistration: boolean;
  /** Whether the cross-hostel RedFlag defaulter registry applies. Pakistan-only:
   *  it is CNIC-keyed and specific to the PK market. Gates the RedFlag nav, page,
   *  actions, and the admission-time screening check. */
  redflag: boolean;
  /** Whether WhatsApp messaging (tenant welcome/payment/checkout/notice/reminders)
   *  is offered. Pakistan-only today — the WhatsApp Business integration is set up
   *  for the PK market. Non-PK hostels use email channels instead. Gates the
   *  automated send path (never reaches a non-PK recipient) and the WhatsApp UI. */
  whatsapp: boolean;
  /** Whether Pulse SaaS billing offers the manual/bank-transfer rail (a PK bank
   *  account + hand-generated platform invoices). Pakistan-only; every other
   *  country is Paddle-only (card). Gates the billing UI's manual plan card + bank
   *  invoice framing and the platform-invoice generation. Resolve via the OWNER's
   *  PROFILE country (billing/legal), not the hostel. */
  manualBankBilling: boolean;
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
    nationalId: { label: "CNIC", example: "42101-1234567-1", digitLengths: [13], groups: [5, 7, 1] },
    guestRegistration: true,
    redflag: true,
    whatsapp: true,
    manualBankBilling: true,
  },
  GB: {
    code: "GB",
    name: "United Kingdom",
    currency: "GBP",
    currencySymbol: "£",
    locale: "en-GB",
    timezone: "Europe/London",
    dialCode: "44",
    // The UK has no CNIC-equivalent mandatory ID number, so the international
    // form captures identity flexibly (Identification Type + free-text number).
    // guestRegistration:false routes to that flexible ID, so this rule is a
    // benign placeholder — it is not shown or validated.
    nationalId: { label: "ID", digitLengths: [] },
    // No government guest-registration portal (no Smart Eye/Hotel Eye), no
    // CNIC-keyed RedFlag registry, no WhatsApp Business integration — UK uses
    // email channels. Billing is card-only via Paddle (no PK bank rail).
    guestRegistration: false,
    redflag: false,
    whatsapp: false,
    manualBankBilling: false,
  },
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

/**
 * True when `code` is a country the app is configured to fully serve.
 *
 * SECURITY: gate features/entitlements on THIS (or an explicit `code === 'PK'`),
 * never on `getCountryConfig(code).code === 'PK'`. getCountryConfig fails OPEN to
 * Pakistan (the most-privileged country: Hotel Eye on, PKR pricing) for any
 * unknown/garbage input, so using it for a gate would grant PK features to a bad
 * code. getCountryConfig is for FORMATTING (never crash); isSupportedCountry is
 * for GATING (fail closed).
 */
export function isSupportedCountry(code: string | null | undefined): boolean {
  return !!code && Object.prototype.hasOwnProperty.call(COUNTRY_CONFIG, code.trim().toUpperCase());
}
