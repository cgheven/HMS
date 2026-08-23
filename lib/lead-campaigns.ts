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

/** An uploaded header image lives in the marketing-assets bucket and can be
 *  changed from the page; a bundled one ships in the app and cannot. */
export type HeaderImageSource = "uploaded" | "bundled";

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
  /** Where Meta fetches the header picture from, only for IMAGE headers.
   *  Meta fetches it itself with none of our cookies, so it has to be public.
   *  Resolved by resolveHeaderImage below — an image uploaded on the Marketing
   *  page wins, otherwise the file bundled at public/marketing/{name}.png. */
  headerImageUrl: string | null;
  /** Which of those two it came from, so the page can offer "Upload" or
   *  "Replace" and say whether changing it needs a deploy. */
  headerImageSource: HeaderImageSource | null;
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

/**
 * Templates that deliberately reuse another template's header artwork.
 *
 * hms_lead_feature_update_v2 is a copy rewrite of hms_lead_feature_update with
 * the identical image, so it points at the file already serving in production.
 * That avoids shipping the same 533 KB twice, and — because the image is
 * already public — lets a test send go out from a dev machine with no deploy,
 * since Meta fetches the link itself and never touches the app's own origin.
 *
 * Legacy, and deliberately not extended: since migration 202 a template needs
 * no entry here and no file in the bundle — upload its artwork on the Marketing
 * page and the URL is public immediately. This map only keeps v2 sending.
 *
 * Explicit, rather than a general "_vN falls back to its base name" rule. That
 * rule would also swallow the exact case assertHeaderImageReachable exists to
 * catch: a future v3 with genuinely NEW artwork that nobody uploaded would
 * silently resolve to v2's picture, pass the reachability check, and send the
 * wrong image to every prospect while reporting success. An entry here is a
 * decision someone made on purpose; a template with no entry and no file of its
 * own still fails loudly, which is the behaviour worth keeping.
 */
const SHARED_HEADER_IMAGE: Record<string, string> = {
  hms_lead_feature_update_v2: "hms_lead_feature_update",
};

/**
 * Where this template's header picture comes from.
 *
 * An upload wins over the bundle unconditionally. That is the whole point: the
 * bundled file can only be changed by a deploy, so if someone has uploaded a
 * replacement they have already said which one they mean.
 *
 * `uploaded` is keyed by template name and comes from listing the bucket, so a
 * template nobody has uploaded for simply falls through to the old convention
 * path and keeps working exactly as it did.
 */
function resolveHeaderImage(
  name: string,
  siteOrigin: string,
  uploaded: Record<string, string>
): { url: string; source: HeaderImageSource } {
  const alias = SHARED_HEADER_IMAGE[name] ?? name;
  const own = uploaded[name] ?? uploaded[alias];
  if (own) return { url: own, source: "uploaded" };
  return { url: `${siteOrigin}/marketing/${alias}.png`, source: "bundled" };
}

export function parseMetaTemplate(
  t: MetaTemplate,
  siteOrigin: string,
  uploaded: Record<string, string> = {}
): CampaignTemplate {
  const components = t.components ?? [];
  const header = components.find((c) => c.type === "HEADER");
  const body = components.find((c) => c.type === "BODY");
  const footer = components.find((c) => c.type === "FOOTER");
  const buttonsComp = components.find((c) => c.type === "BUTTONS");

  const name = t.name ?? "";
  const bodyText = body?.text ?? "";
  const bodyParamCount = countBodyParams(bodyText);
  const headerFormat = (header?.format ?? (header ? "TEXT" : "NONE")) as CampaignTemplate["headerFormat"];
  const headerImage =
    headerFormat === "IMAGE" ? resolveHeaderImage(name, siteOrigin, uploaded) : null;

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
    headerImageUrl: headerImage?.url ?? null,
    headerImageSource: headerImage?.source ?? null,
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

/** `hms_lead_feature_update_v2` → base `hms_lead_feature_update`, version 2.
 *  A name with no suffix is version 1 of its own family. */
function templateFamily(name: string): { base: string; version: number } {
  const m = name.match(/_v(\d+)$/);
  return m ? { base: name.slice(0, name.length - m[0].length), version: Number(m[1]) } : { base: name, version: 1 };
}

/**
 * Which template the page opens on.
 *
 * Alphabetical order alone opens on `hms_lead_feature_update` even though
 * `hms_lead_feature_update_v2` supersedes it. The two sit next to each other in
 * the dropdown and differ by a few lines of copy, which is exactly the kind of
 * mistake nobody catches until fifty prospects have had the superseded wording.
 * So a `_vN` suffix beats its own bare base name, and a higher N beats a lower.
 *
 * Nothing is hidden — every approved template is still listed and switchable;
 * this only decides the starting selection. And it stays true without a deploy:
 * the day a v3 is approved it becomes the default on its own, same as the rest
 * of this file's live-from-Meta design.
 */
export function defaultCampaignTemplate(templates: CampaignTemplate[]): CampaignTemplate | null {
  // Sendable ones only, mirroring what the page could actually send. Sorted by
  // name upstream, so the first is the alphabetically-first family.
  const sendable = templates.filter((t) => !t.unsupported);
  if (sendable.length === 0) return templates[0] ?? null;

  const { base } = templateFamily(sendable[0].name);
  return sendable
    .filter((t) => templateFamily(t.name).base === base)
    .reduce((best, t) => (templateFamily(t.name).version > templateFamily(best.name).version ? t : best));
}

// ─────────────────────────────────────────────────────────────────────────────
// "Is this lead already one of our clients?"
// ─────────────────────────────────────────────────────────────────────────────
//
// Three live paying clients were found sitting in the lead list as untouched
// prospects, with no flag on any of them:
//
//   Continental Boys Hostel   Lahore  status 'new'         → Continental Royal Heights
//   Makkah Boys Hostel        Lahore  status 'onboarding'  → Makkah Branch # 2
//   Syed Residencies          Lahore  status 'onboarding'  → Syed Residencies UCP/UMT
//
// Continental carried ZERO warnings, so "Select all clean" swept it in and the
// owner would have received a cold pitch for software he already pays for.
//
// The two checks that existed could not have caught them. converted_hostel_id
// is null for all 15 hostels — nobody was onboarded through this CRM, so that
// branch has never fired — and the phone comparison is exact while the real
// numbers differ by one typo'd digit (03214272165 vs 03214277165). Matching
// therefore has to be fuzzy, which means false positives, which is why the
// block it produces is overridable per lead rather than absolute.

/** Words that appear in half the hostels in Pakistan. Matching on these would
 *  flag every lead against every client. "executive" is deliberately NOT here:
 *  it is the only distinctive token in "Executive Boys Hostel", which is how
 *  that lead resolves to Chohan Executive. */
const NAME_STOPWORDS = new Set([
  "hostel", "hostels", "boys", "girls", "branch", "the", "and", "for",
  "boy", "girl", "hostal", "hostle", "pvt", "ltd",
]);

/**
 * The distinctive tokens of a name, in a stable order, as one string.
 *
 * "Makkah Hostel" and "Makkah Boys Hostel Branch # 2" both reduce to "makkah" —
 * the same business written twice — while "Royal Hostels" reduces to "royal"
 * and "Continental Boys Hostel Royal Heights" to "continental|heights|royal",
 * which are not the same name and no longer pretend to be.
 */
function nameSignature(raw: string | null | undefined): string {
  return [...new Set(nameTokens(raw))].sort().join("|");
}

/** Distinctive words in a business or hostel name, lowercased.
 *  Four characters and up: "al", "ms" and "g11" match far too much. */
function nameTokens(raw: string | null | undefined): string[] {
  return (raw ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !NAME_STOPWORDS.has(w));
}

function normalizeName(raw: string | null | undefined): string {
  return (raw ?? "").toLowerCase().replace(/[^a-z]/g, "");
}

/** A single given name is not evidence. "Najam" matched a lead in Karachi
 *  against our own super-admin's profile purely because both are called Najam —
 *  a full name of two or more words is the minimum that means anything. */
function isFullName(raw: string | null | undefined): boolean {
  return (raw ?? "").trim().split(/\s+/).filter((w) => w.length >= 2).length >= 2;
}

/** Our own staff accounts are not clients, and they own real branches, so they
 *  are in hms_profiles like anyone else. Left in, every lead whose owner shares
 *  a first name with someone on the team gets flagged. */
function isInternal(email: string | null | undefined): boolean {
  return (email ?? "").toLowerCase().trim().endsWith("@yourpulse.io");
}

/** Everything known about who is already a paying client, indexed for lookup.
 *  Built once per audience query rather than per lead — 92 leads against 15
 *  hostels is otherwise 1,380 string comparisons for no reason. */
export interface ClientFingerprint {
  /** Canonical E.164 digits from normalizePhoneDigits. */
  phones: Map<string, string>;
  /** Last 7 digits → label. Catches the single-digit typo that defeats an
   *  exact match; 7 is long enough that a collision between two unrelated
   *  Pakistani mobiles is not something worth designing around. */
  phoneTails: Map<string, string>;
  /**
   * Client names reduced to their distinctive tokens, for the two name rules
   * below. A flat token → label map was the previous design and it is what
   * flagged "Royal Hostel Garden" as "Continental Boys Hostel Royal Heights":
   * one shared word between two unrelated businesses.
   */
  names: { tokens: Set<string>; signature: string; label: string }[];
  /** Exact distinctive-token signature → label, for the equal-name rule. */
  nameSignatures: Map<string, string>;
  /** Fully normalized owner name → label. */
  ownerNames: Map<string, string>;
}

export function buildClientFingerprint(
  hostels: { name: string | null }[],
  profiles: { phone: string | null; full_name: string | null; business_name: string | null; email: string | null }[],
  normalizePhone: (v: string | null | undefined) => string | null
): ClientFingerprint {
  const fp: ClientFingerprint = {
    phones: new Map(),
    phoneTails: new Map(),
    names: [],
    nameSignatures: new Map(),
    ownerNames: new Map(),
  };

  const addName = (raw: string | null | undefined, label: string) => {
    const tokens = new Set(nameTokens(raw));
    if (tokens.size === 0) return;
    const signature = nameSignature(raw);
    fp.names.push({ tokens, signature, label });
    if (!fp.nameSignatures.has(signature)) fp.nameSignatures.set(signature, label);
  };

  for (const h of hostels) if (h.name) addName(h.name, h.name);

  for (const p of profiles) {
    if (isInternal(p.email)) continue;
    const label = p.business_name || p.full_name || "an existing client";
    const digits = normalizePhone(p.phone);
    if (digits) {
      if (!fp.phones.has(digits)) fp.phones.set(digits, label);
      const tail = digits.slice(-7);
      if (!fp.phoneTails.has(tail)) fp.phoneTails.set(tail, label);
    }
    const owner = normalizeName(p.full_name);
    if (isFullName(p.full_name) && owner.length >= 8 && !fp.ownerNames.has(owner)) {
      fp.ownerNames.set(owner, label);
    }
    addName(p.business_name, label);
  }

  return fp;
}

/** Why this lead looks like a client, phrased for the badge tooltip — or null.
 *  Ordered strongest evidence first, so the reason shown is the best one. */
export function matchExistingClient(
  lead: { business_name: string | null; owner_name: string | null; phone: string | null },
  fp: ClientFingerprint,
  normalizePhone: (v: string | null | undefined) => string | null
): string | null {
  const digits = normalizePhone(lead.phone);
  if (digits) {
    const exact = fp.phones.get(digits);
    if (exact) return `Phone is an exact match for ${exact}`;
    const tail = fp.phoneTails.get(digits.slice(-7));
    if (tail) return `Phone is one or two digits off ${tail}`;
  }

  if (isFullName(lead.owner_name)) {
    const byOwner = fp.ownerNames.get(normalizeName(lead.owner_name));
    if (byOwner) return `Owner name matches ${byOwner}`;
  }

  return matchBusinessName(lead.business_name, fp);
}

/**
 * Business-name matching, deliberately strict.
 *
 * One shared word is not evidence. Measured against the real list, single-token
 * overlap flagged six prospects — Royal Hostel Garden, Royal Hostels, Noor Boys
 * Hostel, two Syeds and Executive Boys Hostel — on words as generic as "royal"
 * and "executive", and caught nothing that phone, owner name or pipeline status
 * had not already caught. It was pure cost.
 *
 * Two rules replace it, both requiring the whole name to agree rather than a
 * word of it:
 *
 *   1. Identical distinctive names. "Makkah Hostel" and "Makkah Boys Hostel
 *      Branch # 2" are one business written two ways.
 *   2. Two or more shared distinctive words. "Chohan Executive Boys" against
 *      "Chohan Executive" is a real match; "Kamal Executive Girls" against it
 *      is not, and only the second word was ever shared.
 *
 * A frequency cutoff was the obvious alternative and the data refuses it:
 * "royal" appears in 4 names and "executive" in 5, so the generic word is
 * RARER than one behind a true match. Rarity cannot separate these; agreement
 * across the whole name can.
 */
function matchBusinessName(businessName: string | null, fp: ClientFingerprint): string | null {
  const tokens = new Set(nameTokens(businessName));
  if (tokens.size === 0) return null;

  const exact = fp.nameSignatures.get([...tokens].sort().join("|"));
  if (exact) return `Business name is the same as ${exact}`;

  for (const candidate of fp.names) {
    let shared = 0;
    for (const tok of tokens) if (candidate.tokens.has(tok)) shared++;
    if (shared >= 2) return `Business name matches ${candidate.label} on ${shared} words`;
  }

  return null;
}


/** Typo'd and shorthand cities, folded so "Pindi" is targetable as Rawalpindi
 *  rather than sitting alone as its own one-lead group. */
const CITY_ALIASES: Record<string, string> = {
  pindi: "Rawalpindi",
  rwp: "Rawalpindi",
  isb: "Islamabad",
  khi: "Karachi",
  lhr: "Lahore",
  lahor: "Lahore",
};

/** A city label to group and target on. Junk that reached the field — "1", "4"
 *  are both really in there — collapses into one bucket instead of producing a
 *  filter chip nobody will ever click. */
export const OTHER_CITY = "Unknown / other";

export function canonicalCity(raw: string | null | undefined): string {
  const v = (raw ?? "").trim();
  if (!v) return OTHER_CITY;
  const alias = CITY_ALIASES[v.toLowerCase()];
  if (alias) return alias;
  // Needs at least three consecutive letters to be a place name.
  if (!/[A-Za-z]{3}/.test(v)) return OTHER_CITY;
  return v.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}
