import { notFound } from "next/navigation";
import { getPublicHostel } from "@/app/actions/public";
import { JoinFormClient } from "./join-form-client";
import { PublicShell } from "../../public-shell";

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ room?: string }>;
}

export default async function JoinPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { room } = await searchParams;
  const { hostel, error } = await getPublicHostel(slug);

  if (error || !hostel) notFound();

  return (
    <PublicShell>
      <JoinFormClient hostel={hostel} preselectedRoomNumber={room ?? null} />
    </PublicShell>
  );
}
