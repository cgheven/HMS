// Pakistani mobile numbers reach this database in every shape a person can type:
// 03001234567, 0300-1234567, +92 300 0000000, +923001234567, and all of those
// again with stray spaces. Nothing ever normalised them on the way in, so ~20
// call sites re-derive digits inline in two different flavours — one of which
// (`phone.replace(/\D/g,"")` on its own) leaves the local trunk "0" that the
// WhatsApp API rejects.
//
// Anything that has to MATCH two numbers against each other — RedFlag lookups
// compare a number typed by one hostel against a number typed by another — needs
// a single canonical form, so that lives here: bare E.164 digits, Pakistan's 92
// country code, no "+". Display formatting is deliberately a separate function:
// a canonical value is for comparison, never for showing to a person.

const PK_CC = "92";

/** announcements.ts:80 already treats anything under 10 digits as unusable. */
const MIN_DIGITS = 10;

/** E.164 ceiling — longer than this means the field is holding junk, not a number. */
const MAX_DIGITS = 15;

/** Canonical form for storage and comparison: digits only, country code first,
 *  no separators. Returns null for anything too short/long to be a real number,
 *  so callers get one explicit "unusable" case instead of a silent bad match. */
export function normalizePhoneDigits(input: string | null | undefined): string | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;

  // Drops "+", dashes, spaces and parentheses in one pass.
  let d = raw.replace(/\D/g, "");
  if (d.length < MIN_DIGITS) return null;

  // Order matters: "0092…" is an international trunk prefix and must be peeled
  // before the local-trunk rule below would mistake its first 0 for a PK "0300".
  if (d.startsWith("00")) d = d.slice(2);

  if (d.startsWith("0")) {
    d = PK_CC + d.slice(1);
  } else if (!d.startsWith(PK_CC) && d.length === MIN_DIGITS) {
    // "3001234567" — a PK mobile with both the "+92" and the "0" left off.
    d = PK_CC + d;
  }

  if (d.length < MIN_DIGITS || d.length > MAX_DIGITS) return null;
  return d;
}

/** Redact for logs, audit metadata and anything shown across organizations.
 *  Keeps enough head/tail for a human to recognise their own number without
 *  making the value re-identifiable on its own. */
export function maskPhone(digits: string | null | undefined): string {
  const d = (digits ?? "").replace(/\D/g, "");
  if (!d) return "—";
  if (d.length <= 4) return "*".repeat(d.length);
  const head = Math.min(4, d.length - 3);
  return `${d.slice(0, head)}${"*".repeat(d.length - head - 3)}${d.slice(-3)}`;
}

/** Light, display-only. Never feed this back into matching or storage — it is
 *  lossy by design and only ever meant for a screen or an email body. */
export function formatPhoneDisplay(input: string | null | undefined): string {
  const d = normalizePhoneDigits(input);
  if (!d) return (input ?? "").trim();
  if (d.startsWith(PK_CC) && d.length === 12) {
    return `+92 ${d.slice(2, 5)} ${d.slice(5)}`;
  }
  return `+${d}`;
}
