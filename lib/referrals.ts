import type { ReferralStatus } from "@/types";

// No 0/O, no 1/I/L. A referral code's whole job is to survive being read aloud
// down a phone line and typed back in by someone who has never seen it written.
export const REFERRAL_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export const REFERRAL_CODE_LENGTH = 8;

// 31 symbols don't divide 256, so the top 8 byte values would bias the first
// eight letters of the alphabet. Bytes at or above this are discarded instead.
const UNBIASED_BYTE_CEILING = 256 - (256 % REFERRAL_CODE_ALPHABET.length);

/**
 * Web Crypto, not node:crypto and never Math.random — this module is imported
 * by the client for its labels, so a `crypto` import would follow it into the
 * browser bundle. globalThis.crypto is present in both Node 18+ and browsers.
 */
export function generateReferralCode(length: number = REFERRAL_CODE_LENGTH): string {
  let code = "";
  const buf = new Uint8Array(length * 2);
  while (code.length < length) {
    globalThis.crypto.getRandomValues(buf);
    for (const byte of buf) {
      if (byte >= UNBIASED_BYTE_CEILING) continue;
      code += REFERRAL_CODE_ALPHABET[byte % REFERRAL_CODE_ALPHABET.length];
      if (code.length === length) break;
    }
  }
  return code;
}

/**
 * Canonical form for lookup. Codes are minted from an uppercase alphabet, so
 * upper-casing and dropping everything outside it makes resolution
 * case-insensitive without ever handing a user-supplied string to a LIKE
 * pattern (where "%" would match every code in the table).
 */
export function normalizeReferralCode(input: string | null | undefined): string {
  return (input ?? "")
    .toUpperCase()
    .split("")
    .filter((ch) => REFERRAL_CODE_ALPHABET.includes(ch))
    .join("")
    .slice(0, REFERRAL_CODE_LENGTH);
}

export function referralLinkFor(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, "")}/ref/${code}`;
}

export const REFERRAL_STATUS_CONFIG: Record<ReferralStatus, { label: string; cls: string }> = {
  pending:  { label: "Pending",  cls: "bg-amber/10 text-amber border-amber/25" },
  joined:   { label: "Joined",   cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  rejected: { label: "Rejected", cls: "bg-rose-500/10 text-rose-400 border-rose-500/20" },
  expired:  { label: "Expired",  cls: "bg-white/5 text-muted-foreground border-white/10" },
};

export const REFERRAL_STATUS_ORDER: ReferralStatus[] = ["pending", "joined", "rejected", "expired"];

/** Cap on how many submissions one tenant's link may have waiting at once.
 *  Enforced inside hms_submit_referral (migration 174), not in application
 *  code — a COUNT followed by an INSERT is a ceiling only when nobody is
 *  submitting concurrently. */
export const MAX_PENDING_PER_REFERRER = 25;

export const REFERRAL_NAME_MAX_LENGTH = 80;
export const REFERRAL_PHONE_MAX_LENGTH = 20;
/** The honeypot is the one field a person never fills and a bot always does, so
 *  it is also the one an attacker can stuff to the 30mb serverActions body
 *  limit. Capped like every other field. */
export const REFERRAL_HONEYPOT_MAX_LENGTH = 200;
export const REFERRAL_CODE_INPUT_MAX_LENGTH = 64;

// Hourly ceilings, all enforced atomically by hms_referral_rate_window.
// Per (link, IP) first and generously, because a whole branch shares one WiFi
// IP and Pakistani mobile users share carrier NAT — a flat per-IP cap silently
// swallows the back half of a referral push. The per-IP and per-branch ceilings
// above it exist for the case those shared addresses are one attacker.
export const REFERRAL_IP_LINK_HOURLY_LIMIT = 10;
export const REFERRAL_IP_HOURLY_LIMIT = 120;
export const REFERRAL_HOSTEL_HOURLY_LIMIT = 250;
/** Resolving a code is a free service-role query for anyone holding a link, so
 *  the page render is metered too — the submit cap protects nothing while the
 *  lookup beside it is unlimited. */
export const REFERRAL_VIEW_HOURLY_LIMIT = 120;

/**
 * normalizePhoneDigits() accepts any 10-15 digit string, which would let an
 * anonymous submitter mint ~10^10 valid-looking numbers that nobody owns —
 * each one taking a permanent pending-uniqueness slot and each one a live
 * candidate for a false "joined" match. Every branch on this platform serves
 * Pakistani mobiles, so the referral form requires that shape: 92, then a
 * leading 3, then nine digits.
 */
export function isReferrableMobile(digits: string | null | undefined): boolean {
  return /^923\d{9}$/.test(digits ?? "");
}

/**
 * How long a submission stays live before it goes stale.
 *
 * A DEADLINE, not an attribution rule. An empty seat costs the owner rent this
 * month, so the referrer needs a reason to push now — over a longer window the
 * urgency disappears and, with hostel turnover being what it is, the referrer
 * may have checked out before their own referral ever matured.
 *
 * Fixed rather than configurable on purpose: asked "how many days should a
 * referral stay valid", an owner has no basis to answer, and a wrong short
 * value fails invisibly — referrals simply stop matching with nothing on screen
 * to explain why.
 *
 * Mirrored in migration 176's pending-cap interval. Change one, change both.
 */
export const REFERRAL_PENDING_TTL_DAYS = 14;

/** True once a pending submission has passed the deadline. Derived at read
 *  time — the status column is never rewritten, which keeps
 *  getReferralOverview read-only. */
export function isReferralStale(status: string, createdAt: string): boolean {
  if (status !== "pending") return false;
  const age = Date.now() - new Date(createdAt).getTime();
  return Number.isFinite(age) && age > REFERRAL_PENDING_TTL_DAYS * 86_400_000;
}
