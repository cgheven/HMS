// Branded client subdomains: {label}.hostels.yourpulse.io.
//
// This file is the single source of truth the browser form, the server action
// and the human eye all read from. The database enforces the same rules in
// migration 155's CHECK constraint — that constraint is the real gate, this is
// the friendly version of it. If you change one, change both, or a name the
// form accepts will blow up as a raw Postgres error on save.

export const SUBDOMAIN_ROOT = "hostels.yourpulse.io";

/** DNS label rules: lowercase alphanumeric plus inner hyphens, 3–63 chars. */
export const SUBDOMAIN_PATTERN = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

// Mirrors the NOT IN list in supabase/migrations/155_owner_subdomain.sql.
export const RESERVED_SUBDOMAINS: readonly string[] = [
  // infrastructure
  "www", "api", "admin", "app", "mail", "email", "smtp", "imap", "pop",
  "ftp", "ns", "ns1", "ns2", "dns", "mx", "cdn", "static", "assets",
  "media", "files", "img", "images", "localhost", "root", "system",
  // environments
  "dev", "development", "stage", "staging", "test", "testing", "demo",
  "preview", "sandbox", "beta", "alpha", "local",
  // product / brand
  "pulse", "hostel", "hostels", "hms", "yourpulse", "portal", "dashboard",
  "status", "blog", "help", "support", "docs", "about", "contact",
  // app route namespaces
  "login", "auth", "account", "signup", "register", "onboarding",
  "billing", "invoice", "invoices", "find", "join", "complaint",
  "sales", "super", "superadmin", "super-admin", "partner", "partners",
  "manager", "managers", "owner", "owners", "tenant", "tenants",
  "guide", "pricing", "settings", "r", "s",
  // credential / payment lures
  "secure", "signin", "log-in", "pay", "payment", "payments", "checkout",
  "verify", "verification", "password", "reset", "wallet", "refund",
  "id", "my",
];

export function normalizeSubdomain(input: string): string {
  return input.trim().toLowerCase();
}

/** null when valid; otherwise the reason, phrased for the person typing it. */
export function subdomainError(input: string): string | null {
  const value = normalizeSubdomain(input);
  if (!value) return "Enter a subdomain";
  if (value.length < 3) return "At least 3 characters";
  if (value.length > 63) return "At most 63 characters";
  if (/[^a-z0-9-]/.test(value)) return "Only lowercase letters, numbers and hyphens";
  if (value.startsWith("-") || value.endsWith("-")) return "Cannot start or end with a hyphen";
  if (!SUBDOMAIN_PATTERN.test(value)) return "Not a valid subdomain";
  if (RESERVED_SUBDOMAINS.includes(value)) return "This name is reserved";
  return null;
}

// Words that describe what a hostel IS rather than which business it is. They
// appear in nearly every branch name and only pad the URL — "Chohan Executive
// Boys Hostel" is chohanexecutive, not chohanexecutiveboyshostel.
const GENERIC_NAME_WORDS = new Set([
  "hostel", "hostels", "hostal", "boys", "girls", "branch", "branches",
  "the", "and", "for", "no", "number",
]);

/** Longest whole-word prefix shared by every name, compared case-insensitively. */
function commonWordPrefix(names: string[]): string {
  if (names.length === 0) return "";
  const split = names.map((n) => n.toLowerCase().split(/\s+/).filter(Boolean));
  const shortest = Math.min(...split.map((w) => w.length));
  const prefix: string[] = [];
  for (let i = 0; i < shortest; i++) {
    const word = split[0][i];
    if (split.every((w) => w[i] === word)) prefix.push(word);
    else break;
  }
  return prefix.join(" ");
}

/**
 * Best-effort default from the client's BUSINESS name — the admin can always
 * overwrite it. Derived from branch names rather than the owner's personal name,
 * because the subdomain is what residents see and share.
 *
 * With several branches, the shared prefix is the business: "Syed Residencies
 * Boys Hostel UCP" + "Syed Residencies Branch UMT" gives syedresidencies,
 * dropping the campus qualifier that only identifies one branch.
 */
export function suggestSubdomain(branchNames: string[]): string {
  const usable = branchNames.map((n) => n?.trim()).filter((n): n is string => !!n);
  if (usable.length === 0) return "";

  const source = usable.length > 1 ? commonWordPrefix(usable) || usable[0] : usable[0];

  const base = source
    .toLowerCase()
    // Everything after a dash or hash is a branch qualifier, never the business.
    .split(/[-#]/)[0]
    .split(/\s+/)
    .filter((w) => w && !GENERIC_NAME_WORDS.has(w.replace(/[^a-z0-9]/g, "")))
    .join("")
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 63);

  return base.length >= 3 && !subdomainError(base) ? base : "";
}

export function subdomainUrl(label: string): string {
  return `https://${label}.${SUBDOMAIN_ROOT}`;
}

/**
 * The branded label a Host header resolves to, or null for the ordinary app.
 *
 * Shared by middleware, robots.ts and sitemap.ts so all three agree on what
 * counts as a branded host. They disagreed before: robots compared the raw
 * Host — port and all — against the production root, so on a dev host it fell
 * through to the main-site rules and served one client's domain a sitemap
 * listing every other client's pages.
 */
export function brandedLabelFromHost(rawHost: string | null | undefined): string | null {
  if (!rawHost) return null;
  const hostname = rawHost.split(":")[0].trim().toLowerCase().replace(/\.$/, "");

  const root = hostname.endsWith(`.${SUBDOMAIN_ROOT}`)
    ? `.${SUBDOMAIN_ROOT}`
    : hostname.endsWith(".localhost")
      ? ".localhost"
      : null;
  if (!root) return null;

  const label = hostname.slice(0, -root.length);
  return SUBDOMAIN_PATTERN.test(label) ? label : null;
}
