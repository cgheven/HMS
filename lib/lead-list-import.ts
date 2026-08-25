import { normalizePhoneDigits } from "@/lib/phone";

/**
 * Parsing an imported hostel list into contacts we can actually message.
 *
 * Shared between the client-side preview and the server action that commits,
 * so what the preview promises is byte-for-byte what lands in the database. A
 * second implementation on the server would eventually disagree with the first,
 * and the disagreement would only surface as rows the admin never approved.
 */

/** Columns as they come out of a Places-style scrape, matched case- and
 *  space-insensitively so "Hostel", "hostel name" and "Business Name" all land. */
const COLUMN_ALIASES: Record<keyof RawContact, string[]> = {
  business_name: ["hostel", "hostel name", "business name", "name", "business"],
  phone: ["phone", "mobile", "mobile number", "phone number", "contact", "number"],
  city: ["city", "town", "location", "area"],
  email: ["email", "e-mail", "email address"],
  business_status: ["business_status", "business status", "status"],
};

export interface RawContact {
  business_name: string;
  phone: string;
  city: string;
  email: string;
  business_status: string;
}

export interface ParsedContact {
  business_name: string;
  /** Canonical digits — what dedupe and the send both use. */
  digits: string;
  /** As typed, for display. Kept because the canonical form is unreadable. */
  phone: string;
  city: string | null;
  email: string | null;
}

export type DropReason = "no_phone" | "landline" | "closed" | "duplicate" | "no_name";

export interface ParseResult {
  contacts: ParsedContact[];
  dropped: Record<DropReason, number>;
  /** A handful of real examples per reason, so the preview can show what is
   *  being thrown away rather than only how much. */
  samples: Partial<Record<DropReason, string[]>>;
}

/** A Pakistani mobile in canonical form is 92 + 3XX + 7 digits. Everything else
 *  that survives normalizePhoneDigits — 92 42 …, 92 62 … — is a landline, and a
 *  landline can never receive a WhatsApp message. Filtering here rather than
 *  discovering it one failed send at a time also quietly removes the rows in a
 *  scrape that are not hostels at all: post offices and hotels list landlines. */
export function isPkMobile(digits: string | null): boolean {
  return digits !== null && /^923\d{9}$/.test(digits);
}

/**
 * Scraped listing names carry SEO tails that are useless on a table row and
 * absurd inside a WhatsApp greeting: hashtag spam, and everything after a pipe
 * ("YMCA Hostel Lahore | Best Girls Hostel on Mall Road | Secure | Clean | …").
 *
 * The first segment is normally the real name, but not always — "Dreams | Girls
 * Hostel near University of Lahore" is a brand plus its descriptor, and keeping
 * only "Dreams" loses what the business is. So a very short head keeps its
 * neighbour.
 */
export function cleanHostelName(input: string): string {
  let s = (input ?? "").toString().replace(/#\S+/g, " ");
  const parts = s.split(/[|｜]+/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);
  s = parts.length > 1 && parts[0].length < 15 ? `${parts[0]} — ${parts[1]}` : parts[0] ?? "";
  return s
    .replace(/["“”]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[\s,\-–—]+$/, "")
    .trim();
}

/** "pakpattan", "Pākpattan" and "PAKPATTAN" are one city, and three chips for
 *  it makes the city filter unusable. Diacritics are stripped for the same
 *  reason: nobody types the macron in "Lodhrān". */
export function normalizeCity(input: string): string | null {
  const s = (input ?? "")
    .toString()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return null;
  return s
    .split(" ")
    .map((w) => (w.length > 2 ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toUpperCase()))
    .join(" ");
}

function pick(row: Record<string, unknown>, field: keyof RawContact): string {
  const keys = Object.keys(row);
  for (const alias of COLUMN_ALIASES[field]) {
    const hit = keys.find((k) => k.trim().toLowerCase() === alias);
    if (hit && row[hit] != null) return String(row[hit]).trim();
  }
  return "";
}

/**
 * @param existingDigits canonical numbers already in the database — across the
 *   CRM and every other list, because the point of one shared table is that a
 *   number cannot be reached twice from two directions.
 */
export function parseLeadList(
  rows: Record<string, unknown>[],
  existingDigits: Set<string> = new Set()
): ParseResult {
  const dropped: Record<DropReason, number> = {
    no_phone: 0, landline: 0, closed: 0, duplicate: 0, no_name: 0,
  };
  const samples: Partial<Record<DropReason, string[]>> = {};
  const seen = new Set(existingDigits);
  const contacts: ParsedContact[] = [];

  const note = (reason: DropReason, label: string) => {
    dropped[reason]++;
    const bucket = (samples[reason] ??= []);
    if (bucket.length < 4) bucket.push(label);
  };

  for (const row of rows) {
    const rawName = pick(row, "business_name");
    const rawPhone = pick(row, "phone");
    const label = cleanHostelName(rawName) || rawPhone || "(unnamed row)";

    const status = pick(row, "business_status").toUpperCase();
    // Google reports these on businesses that have shut. Messaging a closed
    // hostel is not a soft failure — it burns a number on the WABA every
    // tenant's rent reminder uses.
    if (status.startsWith("CLOSED")) { note("closed", label); continue; }

    const digits = normalizePhoneDigits(rawPhone);
    if (!digits) { note("no_phone", label); continue; }
    if (!isPkMobile(digits)) { note("landline", `${label} · ${rawPhone}`); continue; }
    if (seen.has(digits)) { note("duplicate", `${label} · ${rawPhone}`); continue; }

    const business_name = cleanHostelName(rawName);
    if (business_name.length < 2) { note("no_name", rawPhone); continue; }

    seen.add(digits);
    const email = pick(row, "email");
    contacts.push({
      business_name,
      digits,
      phone: rawPhone,
      city: normalizeCity(pick(row, "city")),
      email: email.includes("@") ? email.toLowerCase() : null,
    });
  }

  return { contacts, dropped, samples };
}

export const DROP_LABELS: Record<DropReason, string> = {
  no_phone: "no phone number",
  landline: "landline, not a mobile",
  closed: "closed permanently or temporarily",
  duplicate: "number already on a list",
  no_name: "no usable hostel name",
};
