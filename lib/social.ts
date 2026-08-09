// Client social handles for the public branded site: Instagram + Facebook.
//
// HANDLES, NEVER URLS. The value ends up inside an href on a page we serve to
// the public under our own wildcard cert, so the owner must never get to choose
// the scheme or the host. We store "najamhostels" and this file builds
// https://instagram.com/najamhostels. Neither charset below contains ':', '/',
// '\', '?' or '#', so a stored handle cannot express a scheme, a host, a
// protocol-relative //evil.com or a query — the worst a hostile value can do is
// 404 on instagram.com.
//
// This file is the friendly mirror of migration 165's CHECK constraints, the
// same relationship lib/subdomain.ts has with 155. The constraint is the real
// gate — RLS on hms_profiles guards only `role`, so any authenticated account
// can write its own row from devtools, and CHECKs (unlike RLS) are not bypassed
// by the service-role save action either. If you change one, change both, or a
// handle this form accepts will blow up as a raw Postgres error on save.

// Deliberately NOT the `u` flag. Without it, ECMAScript Canonicalize refuses to
// map a non-ASCII character onto an ASCII one, so [a-z] stays ASCII-only and
// homoglyphs (U+0430 Cyrillic а, U+FF41 fullwidth ａ, U+017F ſ) are rejected.
// Under `u`, simple case folding makes ſ match s. Do not "modernise" these.
export const INSTAGRAM_PATTERN = /^[a-z0-9._]{1,30}$/i;
export const FACEBOOK_PATTERN = /^[a-z0-9.]{5,50}$/i;

// Separate from the charset and load-bearing: '..', '.a' and 'a.' all pass both
// patterns above. Instagram and Facebook both reject them, and so does the CHECK.
function dotRulesOk(value: string): boolean {
  return !value.startsWith(".") && !value.endsWith(".") && !value.includes("..");
}

export function normalizeInstagram(input: string): string {
  let value = input.trim();
  // Strip a pasted profile URL ONLY when the host is Instagram's, anchored on
  // the "/" that ends the host. Stripping any "https://host/" prefix would turn
  // https://evil.com/foo into the handle "foo", and a looser anchor would strip
  // https://instagram.com@evil.com/foo or https://instagram.com.evil.com/foo.
  // A non-matching paste keeps its ':' and '/' and fails the pattern.
  value = value.replace(/^https?:\/\/(www\.)?instagram\.com\//i, "");
  value = value.replace(/^@/, "").split(/[?#]/)[0].replace(/\/+$/, "");
  return value.toLowerCase();
}

export function normalizeFacebook(input: string): string {
  let value = input.trim();
  const url = /^https?:\/\/(www\.|m\.|web\.)?facebook\.com\//i;
  if (url.test(value)) {
    const rest = value.replace(url, "");
    // Many Pakistani hostel pages never set a vanity name and are shared as
    // profile.php?id=100064… or /p/Some-Name-100064…. facebook.com/{numeric id}
    // resolves to the page and digits pass FACEBOOK_PATTERN, so extract the id
    // rather than reject the paste. Both matches are anchored to the post-host
    // remainder: matching the raw input would harvest the digits out of
    // https://evil.com/?u=facebook.com/profile.php?id=999999 and silently link
    // the owner to a page they never chose.
    const byId = rest.match(/^profile\.php\?id=(\d+)/i);
    const byPath = rest.match(/^p\/[^/?#]*-(\d{6,})/i);
    value = byId ? byId[1] : byPath ? byPath[1] : rest;
  }
  value = value.replace(/^@/, "").split(/[?#]/)[0].replace(/\/+$/, "");
  return value.toLowerCase();
}

/**
 * null when valid; otherwise the reason, phrased for the person typing it.
 *
 * Takes an ALREADY-NORMALIZED handle, not raw input. normalizeInstagram strips
 * one leading '@' per call and is therefore not idempotent, so a validator that
 * normalized its own argument would judge a different string from the one the
 * caller is about to display and store: "@@najam" normalizes to "@najam", which
 * this function must reject, but a second pass would turn into a valid "najam".
 * One normalization, at the call site, feeding the field, the error and the save.
 */
export function instagramError(value: string): string | null {
  if (!value) return null; // clearing the field is valid
  if (value.length > 30) return "At most 30 characters";
  if (!INSTAGRAM_PATTERN.test(value)) {
    return "Only letters, numbers, dots and underscores — paste the username, not the link";
  }
  if (value.startsWith(".") || value.endsWith(".")) return "Cannot start or end with a dot";
  if (value.includes("..")) return "Cannot contain two dots in a row";
  return null;
}

/** As instagramError: takes an already-normalized handle, never raw input. */
export function facebookError(value: string): string | null {
  if (!value) return null; // clearing the field is valid
  if (value.length < 5) return "At least 5 characters";
  if (value.length > 50) return "At most 50 characters";
  if (!FACEBOOK_PATTERN.test(value)) {
    return "Only letters, numbers and dots — paste the page name, not the link";
  }
  if (value.startsWith(".") || value.endsWith(".")) return "Cannot start or end with a dot";
  if (value.includes("..")) return "Cannot contain two dots in a row";
  return null;
}

/**
 * The single authority on whether a handle may become an href.
 *
 * Applied twice: at render time immediately beside the href, and in the save
 * action against the EXACT string being written. It neither normalizes nor
 * trims — not even whitespace. Trimming would break the guarantee the save
 * action depends on: " najam" would pass here and then fail migration 165's
 * CHECK, so the owner would get the raw 23514 backstop instead of the specific
 * message. What this function approves is what the database will accept.
 *
 * Returns null rather than a repaired value, so a bad row drops the whole
 * anchor instead of emitting one.
 */
export function socialUrl(
  kind: "instagram" | "facebook",
  handle: string | null | undefined,
): string | null {
  if (!handle) return null;
  const pattern = kind === "instagram" ? INSTAGRAM_PATTERN : FACEBOOK_PATTERN;
  if (!pattern.test(handle) || !dotRulesOk(handle)) return null;
  return kind === "instagram"
    ? `https://instagram.com/${handle}`
    : `https://facebook.com/${handle}`;
}
