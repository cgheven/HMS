/**
 * The canonical public origin, for links that leave the app — WhatsApp
 * messages, emails, invoices, referral and bill links.
 *
 * `??` was the wrong operator here. It falls back only on null/undefined, so an
 * env var present but EMPTY — which is exactly how a misconfigured or cleared
 * Vercel variable arrives — produced "" rather than the default, and every
 * outbound link silently became a relative path like "/ref/ABC123": unusable in
 * a WhatsApp message, and broken in a way no build or type check can catch.
 *
 * Also strips trailing slashes, which two call sites were each doing by hand
 * and eleven were not.
 */
const FALLBACK = "https://hostel.yourpulse.io";

export function siteUrl(): string {
  const raw = (process.env.NEXT_PUBLIC_SITE_URL ?? "").trim();
  return (raw || FALLBACK).replace(/\/+$/, "");
}
