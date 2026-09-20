import { getCountryConfig } from "@/lib/country-config";

// PK WhatsApp recipient digits (E.164 without the '+') from a stored owner/branch
// phone. WhatsApp is a PK-only rail (getCountryConfig(c).whatsapp), so the +92
// country code is correct for every caller here.
//
// Tolerant of any stored form, which matters because the signup / add-property
// PhoneInput now stores the BARE national number (no trunk 0):
//   - local            "03001234567" → "923001234567"
//   - bare national     "3001234567" → "923001234567"   (the new PhoneInput form)
//   - already-intl    "923001234567" → "923001234567"
// Replaces the old inline `.replace(/\D/g,"").replace(/^0/,"92")`, which produced
// a country-code-less number for the new bare form (silent send failure).
export function pkWhatsAppDigits(raw: string | null | undefined): string {
  const d = (raw ?? "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("92")) return d;
  return "92" + d.replace(/^0+/, "");
}

// Country-aware version of the above for MANUAL click-to-send wa.me links (a
// non-PK owner's payment confirmation, tenant share, partner/manager invite …).
// Resolves the dial code from the hostel/owner country instead of hardcoding 92.
// Byte-identical to pkWhatsAppDigits for PK (dialCode "92"): a "0300…" number →
// "92300…", an already-international "92…" stays put. Tolerant of the bare-
// national PhoneInput form too (strips trunk zeros, then prepends the dial code).
export function waDigits(raw: string | null | undefined, country: string | null | undefined): string {
  const dial = getCountryConfig(country).dialCode || "";
  const d = (raw ?? "").replace(/\D/g, "");
  if (!d) return "";
  if (dial && d.startsWith(dial)) return d;
  return dial + d.replace(/^0+/, "");
}
