import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getPublicHostelsBySubdomain } from "@/app/actions/public";
import { BusinessPage } from "@/components/find/business-page";
import { buildFaqs } from "@/lib/business-content";
import { businessJsonLd, serializeJsonLd } from "@/lib/business-jsonld";
import { SUBDOMAIN_ROOT } from "@/lib/subdomain";

// Always render fresh — package pricing, availability, and food menu change in real time
export const dynamic = "force-dynamic";
export const revalidate = 0;

interface Props {
  params: Promise<{ subdomain: string }>;
}

/**
 * The origin the visitor actually typed, not the internal rewrite target.
 * Metadata and structured data must both point at the branded domain — a
 * canonical or og:url naming hostel.yourpulse.io would hand the client's SEO
 * back to us and break every WhatsApp share preview.
 */
async function requestOrigin(subdomain: string): Promise<string> {
  const host = (await headers()).get("host") ?? "";
  if (host.startsWith("localhost") || host.includes(".localhost")) {
    return `http://${host}`;
  }
  return `https://${host || `${subdomain}.${SUBDOMAIN_ROOT}`}`;
}

// Branded-subdomain landing page. Reached only via the rewrite in middleware.ts
// — {subdomain}.hostels.yourpulse.io/ becomes /s/{subdomain} internally, so the
// visitor's address bar keeps showing the client's own domain. Branch links are
// domain-relative (hrefBase="") so nobody gets bounced off mid-browse.
export default async function SubdomainHomePage({ params }: Props) {
  const { subdomain } = await params;
  const { branches, branchInfo, ownerName, error } = await getPublicHostelsBySubdomain(subdomain);

  if (error || !branches || branches.length === 0) notFound();

  const info = branchInfo ?? [];
  const faqs = buildFaqs(branches, info);
  const origin = await requestOrigin(subdomain);

  const jsonLd = businessJsonLd({
    ownerName: ownerName ?? null,
    branches,
    branchInfo: info,
    origin,
    hrefBase: "",
    faqs,
  });

  return (
    <>
      {/* Structured data: what lets an answer engine quote this page rather
          than guess at it. Built from the same values rendered below. */}
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />
      <BusinessPage
        ownerName={ownerName ?? null}
        branches={branches}
        branchInfo={info}
        faqs={faqs}
        hrefBase=""
      />
    </>
  );
}

export async function generateMetadata({ params }: Props) {
  const { subdomain } = await params;
  const { branches, ownerName } = await getPublicHostelsBySubdomain(subdomain);
  if (!branches || branches.length === 0) return { title: "Hostel Not Found" };

  const name = ownerName ?? branches[0].name;
  const beds = branches.reduce((s, b) => s + b.available_beds, 0);
  const origin = await requestOrigin(subdomain);

  const title = branches.length === 1 ? branches[0].name : `${name} — Hostels`;
  const description =
    branches.length === 1
      ? `Rooms, pricing and availability at ${branches[0].name}. Contact the owner directly — no agent fees.`
      : `${branches.length} branches${beds > 0 ? `, ${beds} beds available` : ""}. Compare pricing and contact the owner directly — no agent fees.`;

  // The client's own cover photo, not our generic card. These links are shared
  // on WhatsApp constantly, and a real photo of the hostel converts where a
  // stock Pulse image does not.
  const cover = branches.find((b) => b.cover_image_url)?.cover_image_url;

  return {
    metadataBase: new URL(origin),
    title,
    description,
    alternates: { canonical: origin },
    openGraph: {
      type: "website",
      url: origin,
      siteName: name,
      title,
      description,
      ...(cover ? { images: [{ url: cover, alt: name }] } : {}),
    },
    twitter: {
      card: cover ? "summary_large_image" : "summary",
      title,
      description,
      ...(cover ? { images: [cover] } : {}),
    },
    robots: { index: true, follow: true },
  };
}
