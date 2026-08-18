import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { brandedLabelFromHost } from "@/lib/subdomain";
import { siteUrl } from "@/lib/site-url";

/** Pinned for the same reason as in app/sitemap.ts. */
const MAIN_SITE_URL = siteUrl();

export const dynamic = "force-dynamic";

/**
 * One handler, two audiences — the Host header decides which.
 *
 * A branded client subdomain is a public shopfront and should be crawled
 * freely. The app itself is almost entirely behind auth, so pointing crawlers
 * at /dashboard or /super-admin only wastes their budget on login redirects.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const host = (await headers()).get("host") ?? "";
  const isBrandedSubdomain = !!brandedLabelFromHost(host);
  const origin = `https://${host}`;

  if (isBrandedSubdomain) {
    return {
      rules: [{ userAgent: "*", allow: "/" }],
      sitemap: `${origin}/sitemap.xml`,
      host: origin,
    };
  }

  return {
    rules: [
      {
        // Link-preview crawlers, allowed onto /ref/ only.
        //
        // facebookexternalhit HONOURS robots.txt, so the blanket Disallow below
        // meant WhatsApp refused to scrape a referral link and rendered a bare
        // "hostel.yourpulse.io" card with no logo — the tenant shares their link
        // and it looks broken.
        //
        // Safe, because these agents do not publish to a search index: they
        // build a preview card for the person who pasted the link, who already
        // holds it. Nothing is exposed that the recipient could not already see
        // by opening it. /rs/ stays disallowed even here — it renders somebody's
        // name and earnings, and a preview of that is a leak in any context.
        userAgent: [
          "facebookexternalhit",
          "facebookcatalog",
          "WhatsApp",
          "Twitterbot",
          "LinkedInBot",
          "Slackbot-LinkExpanding",
          "TelegramBot",
        ],
        allow: ["/", "/pricing", "/guide", "/ref/"],
        disallow: [
          "/api/",
          "/dashboard",
          "/overview",
          "/settings",
          "/website",
          "/tenants",
          "/payments",
          "/reports",
          "/super-admin",
          "/admin",
          "/sales",
          "/portal",
          "/redflag",
          "/s/",
          "/r/",
          "/rs/",
          "/invoice/",
          "/complaint/",
          "/forgot-password",
          "/reset-password",
        ],
      },
      {
        userAgent: "*",
        // No "/find": the bare index 404s for anonymous visitors by design.
        allow: ["/", "/pricing", "/guide"],
        disallow: [
          "/api/",
          "/dashboard",
          "/overview",
          "/settings",
          "/website",
          "/tenants",
          "/payments",
          "/reports",
          "/super-admin",
          "/admin",
          "/sales",
          "/portal",
          "/redflag",
          "/s/",          // internal rewrite target; the branded host is canonical
          "/r/",          // one-time receipt links
          "/ref/",        // tenant referral links — the path segment IS the credential
          "/rs/",         // referral status pages — same, and it renders earnings
          "/invoice/",    // client invoices
          "/complaint/",
        "/forgot-password",
        "/reset-password",
      ],
      },
    ],
    sitemap: `${MAIN_SITE_URL}/sitemap.xml`,
  };
}
