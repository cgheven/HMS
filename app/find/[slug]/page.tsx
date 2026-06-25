import { notFound } from "next/navigation";
import { getPublicHostel } from "@/app/actions/public";
import { HostelDetailClient } from "@/components/find/hostel-detail-client";

// Always render fresh — package pricing, availability, and food menu change in real time
export const dynamic = "force-dynamic";
export const revalidate = 0;

interface Props {
  params: Promise<{ slug: string }>;
}

export default async function HostelDetailPage({ params }: Props) {
  const { slug } = await params;
  const { hostel, error } = await getPublicHostel(slug);

  if (error || !hostel) notFound();

  return <HostelDetailClient hostel={hostel} />;
}

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const { hostel } = await getPublicHostel(slug);
  if (!hostel) return { title: "Hostel Not Found" };
  return {
    title: `${hostel.name} — HMS Directory`,
    description: hostel.description ?? `View rooms, availability, and food menu for ${hostel.name}.`,
  };
}
