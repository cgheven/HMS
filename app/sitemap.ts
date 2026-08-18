import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { getPublicHostelsBySubdomain } from "@/app/actions/public";
import { brandedLabelFromHost } from "@/lib/subdomain";
import { siteUrl } from "@/lib/site-url";

/** Pinned, not Host-derived: on the main deployment every alias that resolves
 *  here (preview URLs, hms.yourpulse.io) would otherwise publish its own copy
 *  of the same sitemap under a different hostname. */
const MAIN_SITE_URL = siteUrl();

export const dynamic = "force-dynamic";

/**
 * Host-aware, like robots.ts above.
 *
 * On a branded subdomain it lists that one client's pages against their own
 * domain. On the main host it lists the public directory pages. A client's
 * sitemap must never mix the two, or we'd be telling Google their branch pages
 * live on our domain — the same split-authority problem canonical tags exist
 * to prevent.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const host = (await headers()).get("host") ?? "";
  const label = brandedLabelFromHost(host);
  const origin = `https://${host}`;
  const now = new Date();

  if (label) {
    const { branches } = await getPublicHostelsBySubdomain(label);
    if (!branches || branches.length === 0) return [];

    return [
      { url: origin, lastModified: now, changeFrequency: "daily", priority: 1 },
      ...branches
        .filter((b) => b.slug)
        .flatMap((b) => [
          {
            url: `${origin}/${b.slug}`,
            lastModified: now,
            changeFrequency: "daily" as const,
            priority: 0.8,
          },
          {
            url: `${origin}/join/${b.slug}`,
            lastModified: now,
            changeFrequency: "weekly" as const,
            priority: 0.5,
          },
        ]),
    ];
  }

  // Deliberately does NOT enumerate client pages. getPublicHostels() returns
  // every listed branch across ALL owners, and /find itself was removed as a
  // public page on purpose (app/find/page.tsx) — republishing that list here
  // would hand anyone a machine-readable roster of every paying client, and
  // submit our copy of their content to Google in competition with their own
  // branded domain. Only our own marketing pages belong here.
  return [
    { url: `${MAIN_SITE_URL}/pricing`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${MAIN_SITE_URL}/guide`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
  ];
}
