import { notFound } from "next/navigation";
import { getPublicHostel, getPublicHostelsBySubdomain } from "@/app/actions/public";
import { HostelDetailClient } from "@/components/find/hostel-detail-client";
import { BusinessClient } from "@/components/find/business-client";

// Always render fresh — package pricing, availability, and food menu change in real time
export const dynamic = "force-dynamic";
export const revalidate = 0;

interface Props {
  params: Promise<{ subdomain: string }>;
}

// Branded-subdomain twin of /find/[slug]. Reached only via the rewrite in
// middleware.ts — {subdomain}.hostels.yourpulse.io/ becomes /s/{subdomain}
// internally, so the visitor's address bar keeps showing the client's own
// domain. Renders the exact same two components as the path-based route; the
// only difference is that branch links are domain-relative (hrefBase="") so a
// visitor never gets bounced off the branded domain mid-browse.
export default async function SubdomainHomePage({ params }: Props) {
  const { subdomain } = await params;
  const { branches, ownerName, error } = await getPublicHostelsBySubdomain(subdomain);

  if (error || !branches || branches.length === 0) notFound();

  if (branches.length === 1) {
    const only = branches[0];
    if (!only.slug) notFound();
    const { hostel } = await getPublicHostel(only.slug);
    if (!hostel) notFound();
    return <HostelDetailClient hostel={hostel} />;
  }

  return <BusinessClient slug={subdomain} ownerName={ownerName ?? null} branches={branches} hrefBase="" />;
}

export async function generateMetadata({ params }: Props) {
  const { subdomain } = await params;
  const { branches, ownerName } = await getPublicHostelsBySubdomain(subdomain);
  if (!branches || branches.length === 0) return { title: "Hostel Not Found" };

  if (branches.length === 1) {
    return {
      title: `${branches[0].name} — HMS Directory`,
      description: branches[0].description ?? `View rooms, availability, and food menu for ${branches[0].name}.`,
    };
  }

  return {
    title: `${ownerName ?? branches[0].name} — HMS Directory`,
    description: `Browse all ${branches.length} branches.`,
  };
}
