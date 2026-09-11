/**
 * Email canonicalization for abuse-resistant account identity.
 *
 * One person must not be able to spin up many accounts (esp. free trials) from a
 * single mailbox using +tag subaddressing (you+1@, you+2@) or Gmail dot variants
 * (d.e.m.o@ == demo@). We DON'T reject those addresses — plus-addressing is a
 * legitimate, widely-used feature — we collapse them to one canonical form and
 * enforce uniqueness on THAT, so aliases resolve to a single identity while a real
 * user is never turned away.
 *
 * The DB stores hms_profiles.normalized_email (unique index) written from this
 * function; keep the SQL backfill in migration 237 in sync with the rules here.
 */

// Providers that ignore dots in the local part (dots are cosmetic). Kept to the
// well-known ones — applying dot-stripping to a provider that treats dots as
// significant would wrongly merge two different people.
const DOT_INSENSITIVE_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

// Common disposable / throwaway email providers. A starter set of the highest-
// volume ones — not exhaustive; extend from a maintained list as needed. Used to
// block trial-abuse signups, never to silently drop a real user's mail.
const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com", "guerrillamail.com", "guerrillamail.net", "sharklasers.com",
  "10minutemail.com", "10minutemail.net", "tempmail.com", "temp-mail.org",
  "throwawaymail.com", "getnada.com", "yopmail.com", "yopmail.net",
  "dispostable.com", "trashmail.com", "maildrop.cc", "fakeinbox.com",
  "mailnesia.com", "mohmal.com", "emailondeck.com", "spam4.me",
  "tempmailo.com", "mintemail.com", "mytemp.email", "burnermail.io",
]);

function splitEmail(raw: string): { local: string; domain: string } | null {
  const email = (raw ?? "").trim().toLowerCase();
  const at = email.lastIndexOf("@");
  // at < 1 means no local part; no '.' in domain means it isn't a real address.
  if (at < 1 || !email.slice(at + 1).includes(".")) return null;
  return { local: email.slice(0, at), domain: email.slice(at + 1) };
}

/**
 * Canonical form used as the account identity key. Malformed input is returned
 * lower-cased/trimmed unchanged (format validation is a separate concern and
 * rejects it upstream) so this never throws.
 */
export function normalizeEmail(raw: string): string {
  const parts = splitEmail(raw);
  if (!parts) return (raw ?? "").trim().toLowerCase();
  let { local } = parts;
  const { domain } = parts;
  // Strip +tag subaddressing (provider-agnostic; every major provider ignores it).
  const plus = local.indexOf("+");
  if (plus >= 0) local = local.slice(0, plus);
  // Dot-insensitive providers: drop dots and canonicalize googlemail → gmail.
  if (DOT_INSENSITIVE_DOMAINS.has(domain)) {
    local = local.replace(/\./g, "");
    return `${local}@gmail.com`;
  }
  return `${local}@${domain}`;
}

/** True when the address belongs to a known disposable/throwaway provider. */
export function isDisposableEmailDomain(raw: string): boolean {
  const parts = splitEmail(raw);
  return !!parts && DISPOSABLE_DOMAINS.has(parts.domain);
}
