import { requireSuperAdmin } from "@/lib/auth";
import { getGrowthAnalytics } from "@/app/actions/super-admin";
import { GrowthClient } from "@/components/modules/super-admin/growth-client";

export const dynamic = "force-dynamic";

export default async function SuperAdminGrowthPage() {
  await requireSuperAdmin();

  const { branches, totals, error } = await getGrowthAnalytics();

  return (
    <GrowthClient
      branches={branches ?? []}
      totals={totals ?? null}
      loadError={error ?? null}
    />
  );
}
