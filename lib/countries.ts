// The full ISO 3166-1 country list for signup + address country pickers. Names
// are derived from Intl.DisplayNames (available in every modern browser and
// Node), so this file only maintains the alpha-2 codes — no hand-kept name list
// to drift. This is small reference data, NOT the per-country region/city
// datasets we deliberately do not source yet (city/region stay free text).
//
// Distinct from lib/country-config.ts, which is the small CURATED registry of
// countries Pulse fully serves (PK/GB: currency, timezone, ID rules, feature
// gating). Any ISO country can be *picked* here; a chosen country that isn't in
// the curated registry still resolves currency/timezone from what the owner
// selects at signup + Intl (see the international-onboarding work).

// ISO 3166-1 alpha-2. Kept alphabetically by code for easy auditing.
const ISO_ALPHA2 = [
  "AD","AE","AF","AG","AI","AL","AM","AO","AQ","AR","AS","AT","AU","AW","AX","AZ",
  "BA","BB","BD","BE","BF","BG","BH","BI","BJ","BL","BM","BN","BO","BQ","BR","BS","BT","BV","BW","BY","BZ",
  "CA","CC","CD","CF","CG","CH","CI","CK","CL","CM","CN","CO","CR","CU","CV","CW","CX","CY","CZ",
  "DE","DJ","DK","DM","DO","DZ",
  "EC","EE","EG","EH","ER","ES","ET",
  "FI","FJ","FK","FM","FO","FR",
  "GA","GB","GD","GE","GF","GG","GH","GI","GL","GM","GN","GP","GQ","GR","GS","GT","GU","GW","GY",
  "HK","HM","HN","HR","HT","HU",
  "ID","IE","IL","IM","IN","IO","IQ","IR","IS","IT",
  "JE","JM","JO","JP",
  "KE","KG","KH","KI","KM","KN","KP","KR","KW","KY","KZ",
  "LA","LB","LC","LI","LK","LR","LS","LT","LU","LV","LY",
  "MA","MC","MD","ME","MF","MG","MH","MK","ML","MM","MN","MO","MP","MQ","MR","MS","MT","MU","MV","MW","MX","MY","MZ",
  "NA","NC","NE","NF","NG","NI","NL","NO","NP","NR","NU","NZ",
  "OM",
  "PA","PE","PF","PG","PH","PK","PL","PM","PN","PR","PS","PT","PW","PY",
  "QA",
  "RE","RO","RS","RU","RW",
  "SA","SB","SC","SD","SE","SG","SH","SI","SJ","SK","SL","SM","SN","SO","SR","SS","ST","SV","SX","SY","SZ",
  "TC","TD","TF","TG","TH","TJ","TK","TL","TM","TN","TO","TR","TT","TV","TW","TZ",
  "UA","UG","UM","US","UY","UZ",
  "VA","VC","VE","VG","VI","VN","VU",
  "WF","WS",
  "YE","YT",
  "ZA","ZM","ZW",
];

let regionNames: Intl.DisplayNames | null = null;
try {
  regionNames = new Intl.DisplayNames(["en"], { type: "region" });
} catch {
  regionNames = null; // Extremely old runtime — fall back to the raw code.
}

function nameOf(code: string): string {
  try {
    return regionNames?.of(code) ?? code;
  } catch {
    return code;
  }
}

export interface CountryOption {
  code: string;
  name: string;
}

// Alphabetical by display name — how a person scans a country dropdown.
export const COUNTRIES: CountryOption[] = ISO_ALPHA2
  .map((code) => ({ code, name: nameOf(code) }))
  .sort((a, b) => a.name.localeCompare(b.name));

/** Just the display names, alphabetical — ready for a SearchableSelect's options. */
export const COUNTRY_NAMES: string[] = COUNTRIES.map((c) => c.name);

const NAME_BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c.name]));
const CODE_BY_NAME = new Map(COUNTRIES.map((c) => [c.name.toLowerCase(), c.code]));

/** ISO code → display name ("GB" → "United Kingdom"). Unknown → the code. */
export function countryNameOf(code: string | null | undefined): string {
  const key = (code ?? "").trim().toUpperCase();
  return NAME_BY_CODE.get(key) ?? key;
}

/** Display name → ISO code ("United Kingdom" → "GB"). Unknown → null. */
export function countryCodeOfName(name: string | null | undefined): string | null {
  return CODE_BY_NAME.get((name ?? "").trim().toLowerCase()) ?? null;
}

/**
 * Loose UK postcode shape — accepts with or without the space (GOV.UK guidance
 * is deliberately lenient). For a SOFT warning only, never to block entry.
 */
export function looksLikeUkPostcode(v: string | null | undefined): boolean {
  return /^[A-Za-z]{1,2}\d[A-Za-z\d]?\s?\d[A-Za-z]{2}$/.test((v ?? "").trim());
}

/**
 * Very light phone plausibility — just the digit count (E.164 is 7–15 digits).
 * Country phone formats vary too much to enforce, so this is for a SOFT warning
 * only; a number outside this range is probably a typo but never blocked.
 */
export function looksLikePhone(v: string | null | undefined): boolean {
  const digits = (v ?? "").replace(/\D/g, "");
  return digits.length === 0 || (digits.length >= 7 && digits.length <= 15);
}

/**
 * Light, country-agnostic sanity for a free-form ID / document number — Pulse
 * takes documents from many countries, so NO per-country format is enforced
 * here (a passport, driving licence and national ID all differ). Just letters,
 * digits and common separators, reasonable length. Returns an error string to
 * block on, or null when fine. Empty is allowed (the field is optional).
 */
export function validateDocumentNumber(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  if (!t) return null;
  if (t.length > 40) return "ID / document number looks too long — please check it.";
  if (!/^[A-Za-z0-9][A-Za-z0-9 /-]*$/.test(t)) return "ID / document number should be letters, digits, spaces or “-”.";
  return null;
}

/**
 * The right word for the second-level administrative area, by country. UK
 * addresses have a "County", Pakistan a "Province"; elsewhere the neutral
 * "State / Province / Region" covers every naming scheme without a dataset.
 */
export function addressRegionLabel(countryCode: string | null | undefined): string {
  const c = (countryCode ?? "").trim().toUpperCase();
  if (c === "GB") return "County";
  if (c === "PK") return "Province";
  return "State / Province / Region";
}
