import { notFound } from "next/navigation";
import { getPublicHostel, getPublicHostelsBySubdomain } from "@/app/actions/public";
import { JoinFormClient } from "@/app/join/[slug]/join-form-client";

interface Props {
  params: Promise<{ subdomain: string; branchSlug: string }>;
  searchParams: Promise<{ room?: string }>;
}

// Branded-subdomain twin of /join/[slug].
//
// Required because the room "Apply / Register" button emits an absolute
// /join/{slug} href (components/find/hostel-detail-client.tsx:451) — the only
// absolute internal link in the find component graph. Middleware rewrites the
// whole pathname, so on a branded host that becomes /s/{label}/join/{slug} and
// would 404 without this route, killing the conversion path the feature exists
// to serve.
//
// The literal "join" segment sits beside the dynamic [branchSlug] and wins the
// match; hostel slugs are 8-char hex (migration 140) so they can never collide
// with it.
//
// Carries the same ownership check as the branch route — slugs are globally
// unique, so without it {label}.hostels.yourpulse.io/join/{rivalSlug} would
// serve a competitor's application form under this client's brand.
export default async function SubdomainJoinPage({ params, searchParams }: Props) {
  const { subdomain, branchSlug } = await params;
  const { room } = await searchParams;

  const [{ branches, error }, { hostel }] = await Promise.all([
    getPublicHostelsBySubdomain(subdomain),
    getPublicHostel(branchSlug),
  ]);

  if (error || !branches || branches.length === 0 || !hostel) notFound();
  if (!branches.some((b) => b.id === hostel.id)) notFound();

  return <JoinFormClient hostel={hostel} preselectedRoomNumber={room ?? null} />;
}
