import { notFound } from "next/navigation";
import { getPublicHostel, getPublicHostelsByOwner } from "@/app/actions/public";
import { HostelDetailClient } from "@/components/find/hostel-detail-client";
import { BusinessClient } from "@/components/find/business-client";
import { PublicShell } from "../../public-shell";

// Always render fresh — package pricing, availability, and food menu change in real time
export const dynamic = "force-dynamic";
export const revalidate = 0;

interface Props {
  params: Promise<{ slug: string }>;
}

// A business with only one listed branch goes straight to that branch's detail
// page. A business with multiple branches shows an overview of all of them
// here instead, each linking to /find/{slug}/{branchSlug} — both segments are
// short hash codes derived from the hostel's own id (see migration 140), so
// even the nested URL stays short regardless of how long the hostel's name is.
export default async function HostelOrBusinessPage({ params }: Props) {
  const { slug } = await params;
  const { branches, ownerName, error } = await getPublicHostelsByOwner(slug);

  if (error || !branches || branches.length === 0) notFound();

  // No theme prop. Not a limitation — a deliberate boundary: /find is the Pulse
  // directory, where a visitor may be comparing several businesses, and it stays
  // one consistent surface. The owner's appearance choice governs their OWN
  // domain, {label}.hostels.yourpulse.io, end to end.
  if (branches.length === 1) {
    const { hostel } = await getPublicHostel(slug);
    if (!hostel) notFound();
    return <PublicShell><HostelDetailClient hostel={hostel} /></PublicShell>;
  }

  return (
    <PublicShell>
      <BusinessClient slug={slug} ownerName={ownerName ?? null} branches={branches} />
    </PublicShell>
  );
}

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const { branches, ownerName } = await getPublicHostelsByOwner(slug);
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
