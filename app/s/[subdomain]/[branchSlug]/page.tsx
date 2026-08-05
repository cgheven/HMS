import { notFound } from "next/navigation";
import { getPublicHostel, getPublicHostelsBySubdomain } from "@/app/actions/public";
import { HostelDetailClient } from "@/components/find/hostel-detail-client";

// Always render fresh — package pricing, availability, and food menu change in real time
export const dynamic = "force-dynamic";
export const revalidate = 0;

interface Props {
  params: Promise<{ subdomain: string; branchSlug: string }>;
}

// Branded-subdomain twin of /find/[slug]/[branchSlug].
//
// Unlike the path-based route, this one MUST verify the branch belongs to the
// subdomain's business. Slugs are globally unique across all hostels, so
// without the check chohanexecutive.hostels.yourpulse.io/{rivalSlug} would
// serve a competitor's listing under this client's brand and SSL certificate.
// Both lookups are React cache()'d, so the ownership check costs no extra
// query when the parent layout has already resolved the same subdomain.
export default async function SubdomainBranchPage({ params }: Props) {
  const { subdomain, branchSlug } = await params;

  const [{ branches, error }, { hostel }] = await Promise.all([
    getPublicHostelsBySubdomain(subdomain),
    getPublicHostel(branchSlug),
  ]);

  if (error || !branches || branches.length === 0 || !hostel) notFound();
  if (!branches.some((b) => b.id === hostel.id)) notFound();

  return <HostelDetailClient hostel={hostel} backHref="/" backLabel="All Branches" />;
}

export async function generateMetadata({ params }: Props) {
  const { subdomain, branchSlug } = await params;

  const [{ branches }, { hostel }] = await Promise.all([
    getPublicHostelsBySubdomain(subdomain),
    getPublicHostel(branchSlug),
  ]);

  if (!hostel || !branches?.some((b) => b.id === hostel.id)) return { title: "Hostel Not Found" };

  return {
    title: `${hostel.name} — HMS Directory`,
    description: hostel.description ?? `View rooms, availability, and food menu for ${hostel.name}.`,
  };
}
