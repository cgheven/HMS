import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { JoinFormClient } from "./join-form-client";
import type { Hostel } from "@/types";

interface Props {
  params: Promise<{ slug: string }>;
}

export default async function JoinPage({ params }: Props) {
  const { slug } = await params;
  const admin = createAdminClient();

  const { data: hostel } = await admin
    .from("hms_hostels")
    .select("id, name, slug, city, area, phone, email, hostel_type, amenities, listing_enabled, form_config")
    .eq("slug", slug)
    .maybeSingle();

  if (!hostel) notFound();

  return <JoinFormClient hostel={hostel as Hostel} />;
}
