import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { JoinFormClient } from "./join-form-client";
import type { Hostel, PackageTier } from "@/types";

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

  if (!hostel || !hostel.listing_enabled) notFound();

  const { data: pkgConfig } = await admin
    .from("hms_package_configs")
    .select("package_prices")
    .eq("hostel_id", hostel.id)
    .maybeSingle();

  const packagePrices = pkgConfig?.package_prices as Record<string, unknown> | null;
  const tierKeys = packagePrices
    ? Object.keys(packagePrices).filter((k) => k !== "_custom") as PackageTier[]
    : [];
  const availableTiers: PackageTier[] = tierKeys.length > 0
    ? tierKeys
    : ["space_only", "space_food", "space_3meals", "space_food_ac", "space_meals_cooler"];

  return <JoinFormClient hostel={hostel as Hostel} availableTiers={availableTiers} />;
}
