import { notFound } from "next/navigation";
import { getPublicHostelsBySubdomain } from "@/app/actions/public";
import { BusinessPage } from "@/components/find/business-page";

// Always render fresh — package pricing, availability, and food menu change in real time
export const dynamic = "force-dynamic";
export const revalidate = 0;

interface Props {
  params: Promise<{ subdomain: string }>;
}

// Branded-subdomain landing page. Reached only via the rewrite in middleware.ts
// — {subdomain}.hostels.yourpulse.io/ becomes /s/{subdomain} internally, so the
// visitor's address bar keeps showing the client's own domain. Branch links are
// domain-relative (hrefBase="") so nobody gets bounced off mid-browse.
export default async function SubdomainHomePage({ params }: Props) {
  const { subdomain } = await params;
  const { branches, branchInfo, ownerName, error } = await getPublicHostelsBySubdomain(subdomain);

  if (error || !branches || branches.length === 0) notFound();

  // A single-branch business still gets the business page rather than jumping
  // straight to the room list: on a branded domain the landing page is the
  // client's shopfront, and price, amenities, contact and FAQ belong there.
  return (
    <BusinessPage
      ownerName={ownerName ?? null}
      branches={branches}
      branchInfo={branchInfo ?? []}
      hrefBase=""
    />
  );
}

export async function generateMetadata({ params }: Props) {
  const { subdomain } = await params;
  const { branches, ownerName } = await getPublicHostelsBySubdomain(subdomain);
  if (!branches || branches.length === 0) return { title: "Hostel Not Found" };

  const name = ownerName ?? branches[0].name;
  const beds = branches.reduce((s, b) => s + b.available_beds, 0);

  return {
    title: branches.length === 1 ? branches[0].name : `${name} — Hostels`,
    description:
      branches.length === 1
        ? `Rooms, pricing and availability at ${branches[0].name}. Contact the owner directly — no agent fees.`
        : `${branches.length} branches${beds > 0 ? `, ${beds} beds available` : ""}. Compare pricing and contact the owner directly — no agent fees.`,
  };
}
