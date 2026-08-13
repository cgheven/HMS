// Marketing campaigns sent to CRM leads.
//
// Templates are NOT listed here. They are read live from Meta's
// message_templates endpoint, so approving a template in WhatsApp Manager is
// the only step needed to make it sendable — no deploy, no registry to keep in
// sync. It also means the on-screen preview is the approved wording rather
// than what someone remembers submitting: Meta rewrites on approval (it
// stripped the bold markers from the first campaign), and a preview showing
// the submission is a lie the admin has no way to catch.
//
// This file holds only the pure parsing and eligibility logic, shared by the
// server action that fetches and the client that renders. No "server-only" for
// that reason — same as lib/whatsapp-audience.ts.

export interface CampaignButton {
  type: string;
  label: string;
  url: string | null;
}

export interface CampaignTemplate {
  /** Meta template name — also the campaign_key written to the send ledger, so
   *  "has this lead had this campaign?" is answered by the thing that actually
   *  identifies the message. */
  name: string;
  language: string;
  category: string;
  headerFormat: "NONE" | "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT";
  headerText: string | null;
  body: string;
  footer: string | null;
  buttons: CampaignButton[];
  /** Number of distinct {{n}} placeholders in the body. */
  bodyParamCount: number;
  /** Convention-based, only for IMAGE headers: public/marketing/{name}.png.
   *  Meta fetches this itself with none of our cookies, and middleware.ts's
   *  matcher excludes image extensions, so anything under public/ is reachable. */
  headerImageUrl: string | null;
  /** Null when sendable from this page; otherwise why it is not. */
  unsupported: string | null;
}

/** Meta's raw component shape, narrowed to the parts we read. */
interface MetaComponent {
  type?: string;
  format?: string;
  text?: string;
  buttons?: { type?: string; text?: string; url?: string; phone_number?: string }[];
}

export interface MetaTemplate {
  name?: string;
  language?: string;
  category?: string;
  status?: string;
  components?: MetaComponent[];
}

/** Distinct {{1}}, {{2}}… in a body. Counting occurrences instead would treat
 *  a template that repeats {{1}} as needing two values. */
function countBodyParams(body: string): number {
  const seen = new Set<string>();
  for (const m of body.matchAll(/\{\{\s*(\w+)\s*\}\}/g)) seen.add(m[1]);
  return seen.size;
}

export function parseMetaTemplate(t: MetaTemplate, siteOrigin: string): CampaignTemplate {
  const components = t.components ?? [];
  const header = components.find((c) => c.type === "HEADER");
  const body = components.find((c) => c.type === "BODY");
  const footer = components.find((c) => c.type === "FOOTER");
  const buttonsComp = components.find((c) => c.type === "BUTTONS");

  const name = t.name ?? "";
  const bodyText = body?.text ?? "";
  const bodyParamCount = countBodyParams(bodyText);
  const headerFormat = (header?.format ?? (header ? "TEXT" : "NONE")) as CampaignTemplate["headerFormat"];

  // This page fills exactly one value — the greeting. Anything else cannot be
  // populated generically, and guessing would put the wrong text in front of a
  // prospect. Surfaced as a disabled option with the reason, rather than hidden,
  // so an admin who approved a template can see why it is not offered.
  let unsupported: string | null = null;
  if (bodyParamCount > 1) {
    unsupported = `Needs ${bodyParamCount} values — this page only fills a greeting`;
  } else if (headerFormat === "VIDEO" || headerFormat === "DOCUMENT") {
    unsupported = `${headerFormat.toLowerCase()} headers are not supported here`;
  }

  return {
    name,
    language: t.language ?? "en",
    category: t.category ?? "UNKNOWN",
    headerFormat,
    headerText: headerFormat === "TEXT" ? header?.text ?? null : null,
    body: bodyText,
    footer: footer?.text ?? null,
    buttons: (buttonsComp?.buttons ?? []).map((b) => ({
      type: b.type ?? "UNKNOWN",
      label: b.text ?? "",
      url: b.url ?? (b.phone_number ? `tel:${b.phone_number}` : null),
    })),
    bodyParamCount,
    headerImageUrl: headerFormat === "IMAGE" ? `${siteOrigin}/marketing/${name}.png` : null,
    unsupported,
  };
}

/**
 * Placeholder names that reached the CRM instead of a real one.
 *
 * {{1}} is the first thing the recipient reads. "Assalam o Alaikum xx," costs
 * the lead outright, so these are refused rather than sent.
 */
const PLACEHOLDER_NAMES = new Set([
  "xx", "xxx", "x", "xxxx", "na", "n/a", "none", "null", "test", "testing",
  "unknown", "missing", "abc", "asd", "-", "?", "..",
]);

function usableName(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (value.length < 2) return null;
  if (PLACEHOLDER_NAMES.has(value.toLowerCase())) return null;
  // A "name" with no letters at all is a phone number or junk in the wrong field.
  if (!/\p{L}/u.test(value)) return null;
  return value;
}

/**
 * What {{1}} renders as, or null when this lead cannot be greeted at all.
 *
 * A real person's name is cut to the first word — the template greets
 * informally, and "Malik Majid Hussain" reads like a bank letter.
 *
 * The business-name fallback is deliberately NOT cut the same way. Roughly a
 * third of leads have owner_name = "Unknown", and first-word-of-business turns
 * "Al Nisa Homes Girl Hostel" into "Al" and "G11 Girls Hostel" into "G11" —
 * greetings that read as a bug to the recipient. The whole business name is
 * clunkier but always coherent.
 *
 * `usedBusinessName` lets the page mark those rows, because in the table a
 * business-name greeting is otherwise indistinguishable from a personal one.
 */
export function campaignGreeting(
  ownerName: string | null | undefined,
  businessName: string | null | undefined
): { value: string; usedBusinessName: boolean } | null {
  const person = usableName(ownerName);
  if (person) return { value: person.split(/\s+/)[0], usedBusinessName: false };

  const business = usableName(businessName);
  if (business) return { value: business.replace(/\s+/g, " "), usedBusinessName: true };

  return null;
}
