import { notFound } from "next/navigation";
import { getPublicHostel, getPublicHostelsByOwner } from "@/app/actions/public";
import { HostelDetailClient } from "@/components/find/hostel-detail-client";
import { BusinessClient } from "@/components/find/business-client";

// Always render fresh — package pricing, availability, and food menu change in real time
export const dynamic = "force-dynamic";
export const revalidate = 0;

interface Props {
  params: Promise<{ slug: string }>;
}

// A business with only one listed branch goes straight to that branch's detail
// page (identical to today's behavior). A business with multiple branches shows
// all of them here instead — so a business's shareable link never surfaces
// other owners' hostels the way the global /find directory does.
export default async function HostelOrBusinessPage({ params }: Props) {
  const { slug } = await params;
  const { branches, ownerName, error } = await getPublicHostelsByOwner(slug);

  if (error || !branches || branches.length === 0) notFound();

  if (branches.length === 1) {
    const { hostel } = await getPublicHostel(slug);
    if (!hostel) notFound();
    return <HostelDetailClient hostel={hostel} />;
  }

  return <BusinessClient slug={slug} ownerName={ownerName ?? null} branches={branches} />;
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
