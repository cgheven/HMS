/**
 * Client-side GA4 (gtag.js) helper — the single entry point for product
 * analytics. Deliberately small and defensive:
 *
 *   - Privacy-first: only a WHITELIST of non-sensitive, categorical parameter
 *     keys is ever forwarded (see ALLOWED_PARAM_KEYS). Anything else is dropped,
 *     so a caller mistake can never leak PII, IDs, amounts or free text to GA.
 *   - Never runs on the server (guards on `typeof window`).
 *   - Never throws — analytics must not be able to break a user workflow.
 *   - Off by default outside production; opt in locally with
 *     NEXT_PUBLIC_GA_DEBUG=true for GA DebugView testing (mirrors the
 *     NEXT_PUBLIC_* boolean-flag convention used by lib/redflag-flag.ts).
 *
 * Business events are fired ONLY after the relevant action is confirmed
 * successful by its caller — never from a component render.
 */

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
  }
}

export const GA_MEASUREMENT_ID =
  process.env.NEXT_PUBLIC_GA_ID || "G-KTBY62T8PL";

/** GA runs in production, or when explicitly opted in for local DebugView. */
export const GA_ENABLED =
  process.env.NODE_ENV === "production" ||
  process.env.NEXT_PUBLIC_GA_DEBUG === "true";

/** Adds GA4 DebugView routing when opted in locally. */
export const GA_DEBUG = process.env.NEXT_PUBLIC_GA_DEBUG === "true";

/**
 * The ONLY parameter keys allowed to reach GA. All values these carry are
 * controlled categoricals already present in the app — never PII or business
 * figures. A whitelist (not a blocklist) so nothing sensitive slips through.
 */
const ALLOWED_PARAM_KEYS = new Set<string>([
  "signup_method", // email | google | other
  "auth_method", // email | google | other
  "market", // uk | pakistan | international
  "plan", // basic | standard | business | enterprise
  "from_plan",
  "to_plan",
  "module", // properties | rooms | residents | billing | complaints | reports
  "method", // categorical method, e.g. cash | bank_transfer
  "role", // owner | manager | partner
  "source", // categorical origin, e.g. owner | manager | application
  "debug_mode",
]);

export type AnalyticsParams = Record<
  string,
  string | number | boolean | undefined
>;

function getGtag(): ((...args: unknown[]) => void) | null {
  if (typeof window === "undefined") return null; // never during SSR
  const g = window.gtag;
  return typeof g === "function" ? g : null;
}

function sanitize(params: AnalyticsParams): AnalyticsParams {
  const safe: AnalyticsParams = {};
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    if (!ALLOWED_PARAM_KEYS.has(k)) continue; // drop anything not whitelisted
    safe[k] = v;
  }
  if (GA_DEBUG) safe.debug_mode = true;
  return safe;
}

/** Fire a GA4 event. No-op when disabled, on the server, or if gtag is absent. */
export function trackEvent(
  eventName: string,
  params: AnalyticsParams = {}
): void {
  try {
    if (!GA_ENABLED) return;
    const gtag = getGtag();
    if (!gtag) return;
    gtag("event", eventName, sanitize(params));
  } catch {
    /* analytics must never break the app */
  }
}

/** Map a country code to a coarse, non-sensitive market bucket for GA. */
export function marketFromCountry(
  country: string | null | undefined
): "uk" | "pakistan" | "international" | undefined {
  if (!country) return undefined;
  const c = country.toUpperCase();
  if (c === "GB") return "uk";
  if (c === "PK") return "pakistan";
  return "international";
}

/**
 * Fire an event at most once per browser (per account where a key is given),
 * backed by localStorage. Used to belt-and-brace client-observed "first_*"
 * milestones so a refresh / back-forward cannot double-count. The authoritative
 * first-time signal is still the backend row COUNT the caller checks; this only
 * guards the client fire.
 */
export function trackOnce(storageKey: string, fire: () => void): void {
  try {
    if (!GA_ENABLED) {
      fire(); // keep dev behaviour observable; trackEvent still no-ops
      return;
    }
    const key = `pulse_ga_once:${storageKey}`;
    if (typeof window !== "undefined") {
      if (window.localStorage.getItem(key)) return;
      window.localStorage.setItem(key, "1");
    }
    fire();
  } catch {
    // localStorage can throw (private mode) — fire anyway rather than lose the event
    try {
      fire();
    } catch {
      /* ignore */
    }
  }
}
