import { notFound } from "next/navigation";
import { getPublicHostel } from "@/app/actions/public";
import { HostelDetailClient } from "@/components/find/hostel-detail-client";
import { PublicShell } from "../../../public-shell";

// Always render fresh — package pricing, availability, and food menu change in real time
export const dynamic = "force-dynamic";
export const revalidate = 0;

interface Props {
  params: Promise<{ slug: string; branchSlug: string }>;
}

export default async function BranchDetailPage({ params }: Props) {
  const { slug, branchSlug } = await params;
  const { hostel, error } = await getPublicHostel(branchSlug);

  if (error || !hostel) notFound();

  return (
    <PublicShell>
      <HostelDetailClient hostel={hostel} backHref={`/find/${slug}`} backLabel="All Branches" />
    </PublicShell>
  );
}

export async function generateMetadata({ params }: Props) {
  const { branchSlug } = await params;
  const { hostel } = await getPublicHostel(branchSlug);
  if (!hostel) return { title: "Hostel Not Found" };
  return {
    title: `${hostel.name} — HMS Directory`,
    description: hostel.description ?? `View rooms, availability, and food menu for ${hostel.name}.`,
  };
}
