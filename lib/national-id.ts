import { getCountryConfig } from "./country-config";

/**
 * Country-aware national-ID validation & formatting. The rule (label, valid digit
 * counts, display grouping) comes from the country registry, so a Bangladeshi NID
 * validates as readily as a Pakistani CNIC. Resolve `country` from the tenant's
 * HOSTEL (operational primitive), per the keystone resolution contract.
 *
 * Pakistan's rule reproduces lib/cnic.ts exactly (13 digits, 5-7-1 grouping), so
 * wiring these in place of the CNIC helpers is a verified no-op for PK.
 */

/** Progressive display formatter — safe on every keystroke. Drops non-digits,
 *  caps at the country's longest valid length, and applies its dash grouping. */
export function formatNationalId(country: string | null | undefined, input: string): string {
  const rule = getCountryConfig(country).nationalId;
  // Guard a mis-configured empty digitLengths (Math.max(...[]) === -Infinity):
  // fall back to the raw digits rather than silently producing "".
  const max = rule.digitLengths.length ? Math.max(...rule.digitLengths) : Number.MAX_SAFE_INTEGER;
  const d = (input ?? "").replace(/\D/g, "").slice(0, max);
  if (!rule.groups || rule.groups.length === 0) return d;
  const parts: string[] = [];
  let i = 0;
  for (const g of rule.groups) {
    if (i >= d.length) break;
    parts.push(d.slice(i, i + g));
    i += g;
  }
  if (i < d.length) parts.push(d.slice(i));
  return parts.join("-");
}

/** Valid when the digit count (ignoring separators) matches one the country allows. */
export function isValidNationalId(country: string | null | undefined, value: string | null | undefined): boolean {
  const rule = getCountryConfig(country).nationalId;
  const digits = (value ?? "").replace(/\D/g, "").length;
  return rule.digitLengths.includes(digits);
}

/** Normalize before persisting: formatted per the country, or null when empty. */
export function normalizeNationalId(country: string | null | undefined, value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  if (!v) return null;
  return formatNationalId(country, v);
}

/** The field label for this country ("CNIC", "NID", …). */
export function nationalIdLabel(country: string | null | undefined): string {
  return getCountryConfig(country).nationalId.label;
}

/** Whether government guest registration (province/district, Hotel-Eye filing)
 *  applies to this country. Drives whether province/district are required. */
export function requiresGuestRegistration(country: string | null | undefined): boolean {
  return getCountryConfig(country).guestRegistration;
}
