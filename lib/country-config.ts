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

import { COUNTRY_CURRENCY, COUNTRY_TIMEZONE, COUNTRY_DIAL_CODE } from "./country-reference";
import type { PaymentMethod } from "@/types";

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

/**
 * Per-country user-facing terminology. PK keeps the incumbent words the app has
 * always shown; every non-PK market uses the international set. This is FORMATTING
 * (a label swap), never a gate — it resolves through getCountryConfig, which fails
 * OPEN to PK, so any null/legacy/unknown code renders the exact legacy words.
 *
 * Swap ONLY display strings (JSX text, headings, buttons, placeholders, empty
 * states, column headers, toasts) for these. NEVER touch identifiers: variable /
 * prop / function names, the hms_tenants / hms_hostels table names, the
 * ac_per_unit_rate columns, the hms_active_hostel cookie, or route paths
 * (/tenants stays /tenants).
 */
export interface CountryTerms {
  tenant: string;
  tenants: string;
  branch: string;
  branches: string;
  acBilling: string;
  acUnits: string;
  /** The bare metered-utility noun (PK "AC" / non-PK "Electricity"), for tiles,
   *  abbreviations and mid-sentence use ("AC Collected", "metered AC"). */
  acShort: string;
  /** Charge line label (PK "AC Charges" / non-PK "Electricity Charges"). */
  acCharges: string;
  /** Meter-reading label (PK "AC Meter Reading" / non-PK "Electricity Meter Reading"). */
  acMeterReading: string;
  /** Recurring flat upkeep charge — "AC Maintenance" in EVERY country, never an
   *  electricity word: hms_recalculate_payment_amount forces this charge to 0 unless
   *  the room actually has an air conditioner, so it services the physical unit. Kept
   *  as a term field only so call sites read uniformly alongside the localised ones. */
  acMaintenance: string;
  /** The metered quantity, plural — PK "units" (1 unit = 1 kWh colloquially),
   *  non-PK "kWh". Used for the consumed amount: "194 kWh". */
  meterUnits: string;
  /** The same quantity, singular, for a per-unit rate: "£0.34/kWh". */
  meterUnit: string;
  mobileNumber: string;
  purposeOfVisit: string;
}

/** The exact legacy words PK has always shown. */
export const PK_TERMS: CountryTerms = {
  tenant: "Tenant",
  tenants: "Tenants",
  branch: "Branch",
  branches: "Branches",
  acBilling: "AC Billing",
  acUnits: "AC Units",
  acShort: "AC",
  acCharges: "AC Charges",
  acMeterReading: "AC Meter Reading",
  acMaintenance: "AC Maintenance",
  meterUnits: "units",
  meterUnit: "unit",
  mobileNumber: "WhatsApp Number",
  purposeOfVisit: "Purpose of Visit",
};

/** The international word set (GB and every future non-PK market). */
export const INTERNATIONAL_TERMS: CountryTerms = {
  tenant: "Resident",
  tenants: "Residents",
  branch: "Property",
  branches: "Properties",
  acBilling: "Electricity Billing",
  acUnits: "Electricity Units",
  acShort: "Electricity",
  acCharges: "Electricity Charges",
  acMeterReading: "Electricity Meter Reading",
  acMaintenance: "AC Maintenance",
  meterUnits: "kWh",
  meterUnit: "kWh",
  mobileNumber: "Mobile Number",
  purposeOfVisit: "Purpose of Stay",
};

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
  /** User-facing terminology set. PK gets the incumbent words; every non-PK
   *  market gets the international set. See CountryTerms. */
  terms: CountryTerms;
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
    terms: PK_TERMS,
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
    terms: INTERNATIONAL_TERMS,
  },
};

/**
 * Resolve a country code to its config. Unknown / null / legacy values fall back
 * to the default (Pakistan) so no caller can ever get `undefined` and every
 * pre-keystone row keeps behaving exactly as before.
 */
// The currency symbol for an ISO 4217 code, via Intl (narrow symbol: "£", "€",
// "$", "₨"). Falls back to the code itself if Intl doesn't recognise it.
function currencySymbolOf(currency: string): string {
  try {
    const parts = new Intl.NumberFormat("en", {
      style: "currency", currency, currencyDisplay: "narrowSymbol",
    }).formatToParts(0);
    return parts.find((p) => p.type === "currency")?.value || currency;
  } catch {
    return currency;
  }
}

function regionName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) || code;
  } catch {
    return code;
  }
}

/**
 * True for any real ISO 3166-1 country we can build a config for (present in the
 * reference data). PK/GB have explicit hand-tuned configs; every other real
 * country is SYNTHESIZED with its own currency/timezone and PK-only features off.
 *
 * NOT a feature gate — features stay off for synthesized countries anyway; use
 * isSupportedCountry for entitlement gating (fail closed to the PK/GB set).
 */
export function isKnownCountry(code: string | null | undefined): boolean {
  if (!code) return false;
  const key = code.trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(COUNTRY_CONFIG, key)
    || Object.prototype.hasOwnProperty.call(COUNTRY_CURRENCY, key);
}

// Build a config for a country with no explicit entry: currency / symbol / locale
// / timezone / dial code from the reference data, INTERNATIONAL terminology, and
// every PK-only rail (guest registration, RedFlag, WhatsApp, bank billing) OFF —
// so no country ever inherits Pakistan's privileged features. PK and GB, having
// explicit configs, never reach here.
function synthesizeCountryConfig(key: string): CountryConfig {
  const currency = COUNTRY_CURRENCY[key] || "USD";
  return {
    code: key,
    name: regionName(key),
    currency,
    currencySymbol: currencySymbolOf(currency),
    locale: `en-${key}`,
    timezone: COUNTRY_TIMEZONE[key] || "UTC",
    dialCode: COUNTRY_DIAL_CODE[key] || "",
    nationalId: { label: "ID", digitLengths: [] },
    guestRegistration: false,
    redflag: false,
    whatsapp: false,
    manualBankBilling: false,
    terms: INTERNATIONAL_TERMS,
  };
}

export function getCountryConfig(code: string | null | undefined): CountryConfig {
  const key = (code ?? "").trim().toUpperCase();
  // Explicit hand-tuned configs (PK, GB) win.
  if (COUNTRY_CONFIG[key]) return COUNTRY_CONFIG[key];
  // Any other REAL country code is synthesized. The valid-code check keeps
  // null / legacy / garbage falling back to Pakistan, so every pre-keystone /
  // all-PK render stays byte-identical.
  if (key && Object.prototype.hasOwnProperty.call(COUNTRY_CURRENCY, key)) {
    return synthesizeCountryConfig(key);
  }
  return COUNTRY_CONFIG[DEFAULT_COUNTRY];
}

/**
 * The rent/deposit collection methods offered in the UI for a country, in menu
 * order. PK keeps its local wallets (JazzCash / Easypaisa / SadaPay); every other
 * country gets only the universal set — a UAE hostel should never see JazzCash.
 * FORMATTING, never a gate: fails open to PK, so PK / null / garbage is unchanged.
 */
export function paymentMethodsForCountry(code: string | null | undefined): PaymentMethod[] {
  const isPk = getCountryConfig(code).currency === "PKR";
  return isPk
    ? ["cash", "bank_transfer", "jazzcash", "easypaisa", "sadapay", "other"]
    : ["cash", "bank_transfer", "other"];
}

/**
 * The user-facing terminology set for a country. Server components/actions call
 * this directly with the hostel/owner country in scope; client components use the
 * useTerms() hook (contexts/hostel-context.tsx), which mirrors useMoney().
 *
 * FORMATTING, never a gate — it fails OPEN to PK (via getCountryConfig), so
 * terms(null | undefined | "PK" | garbage) returns the exact legacy words and
 * every pre-keystone / all-PK render is byte-identical.
 */
export function terms(code: string | null | undefined): CountryTerms {
  return getCountryConfig(code).terms;
}

/**
 * Whether Pulse SaaS billing uses the manual/bank-transfer rail (PK) rather than
 * Paddle card checkout. THE single source of truth for the billing-rail gate —
 * the billing UI, the checkout action, and the tier-sync reconciler must all use
 * THIS one test so they never disagree about who is on cards.
 *
 * Resolves through getCountryConfig, which fails OPEN to Pakistan for null /
 * legacy / unknown codes. That direction is deliberate and money-safe here: a
 * pre-keystone owner with no country stored is a legacy PK client, so treating
 * an unknown code as manual keeps them on hand-invoicing and can NEVER
 * accidentally charge a card. (Contrast the feature gates, which fail CLOSED via
 * isSupportedCountry — the safe direction there is the opposite.)
 */
export function isManualBankBilling(code: string | null | undefined): boolean {
  return getCountryConfig(code).manualBankBilling;
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

/**
 * Every country the app fully serves, for a signup/setup country picker. Order
 * is the registry's own (Pakistan first, the incumbent market). The server still
 * re-validates the chosen code with isSupportedCountry, so this is a convenience
 * for the UI, never the authority.
 */
export const SUPPORTED_COUNTRIES: { code: CountryCode; name: string; dialCode: string }[] =
  Object.entries(COUNTRY_CONFIG).map(([code, cfg]) => ({ code, name: cfg.name, dialCode: cfg.dialCode }));
