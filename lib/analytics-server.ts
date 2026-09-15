import "server-only";
import { createHash } from "crypto";

/**
 * Server-side GA4 via the Measurement Protocol, for business events that are
 * confirmed ONLY in server code with no browser present (Paddle webhook,
 * tier-sync). Mirrors the defensive shape of lib/whatsapp.ts: env-gated,
 * non-throwing, best-effort.
 *
 * DEFAULT NO-OP: does nothing unless GA4_API_SECRET is set, so nothing changes
 * in production until that secret is created in the GA4 dashboard
 * (Admin → Data streams → Measurement Protocol API secrets) and added to the
 * environment. This keeps the billing/webhook paths byte-identical by default.
 *
 * KNOWN LIMITATION (documented, not a bug): the browser's real GA `client_id`
 * (the `_ga` cookie) is not captured anywhere in the app, so server events use a
 * deterministic pseudonymous id derived from the account id. They are therefore
 * NOT stitched to the same GA user/session as the client-side gtag events —
 * conversions and activation attribute correctly, but cross-surface user
 * stitching for these specific server events is approximate. To make it exact,
 * capture the `_ga` cookie at a browser-reachable billing step and persist it.
 *
 * PRIVACY: only a whitelist of categorical keys is ever forwarded. The account
 * id is used solely to derive a pseudonymous client_id (hashed) and is never
 * sent as an event parameter.
 */

const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_ID || "G-KTBY62T8PL";
const GA_API_SECRET = process.env.GA4_API_SECRET;
const GA_DEBUG = process.env.NEXT_PUBLIC_GA_DEBUG === "true";

const ALLOWED_PARAM_KEYS = new Set<string>([
  "plan",
  "from_plan",
  "to_plan",
  "market",
  "method",
  "source",
  "reason",
]);

export type ServerAnalyticsParams = Record<
  string,
  string | number | boolean | undefined
>;

function sanitize(params: ServerAnalyticsParams): ServerAnalyticsParams {
  const safe: ServerAnalyticsParams = {};
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    if (!ALLOWED_PARAM_KEYS.has(k)) continue;
    safe[k] = v;
  }
  return safe;
}

/** Deterministic pseudonymous GA client_id from a stable account id. */
function clientIdFor(accountId: string): string {
  const h = createHash("sha256").update(accountId).digest("hex");
  return `${parseInt(h.slice(0, 8), 16)}.${parseInt(h.slice(8, 16), 16)}`;
}

/**
 * Send one GA4 event server-side. Fire-and-forget: callers should `void` this
 * so analytics can never delay or fail the surrounding business operation.
 */
export async function trackServerEvent(
  accountId: string,
  eventName: string,
  params: ServerAnalyticsParams = {}
): Promise<void> {
  try {
    if (!GA_API_SECRET || !accountId) return; // default no-op until configured
    const endpoint = `https://www.google-analytics.com/${
      GA_DEBUG ? "debug/" : ""
    }mp/collect?measurement_id=${encodeURIComponent(
      GA_MEASUREMENT_ID
    )}&api_secret=${encodeURIComponent(GA_API_SECRET)}`;
    await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientIdFor(accountId),
        events: [{ name: eventName, params: sanitize(params) }],
      }),
    });
  } catch {
    /* analytics must never break billing */
  }
}
