import { getTenants } from "@/lib/data";
import { getAuthContext } from "@/lib/data";
import { createAdminClient } from "@/lib/supabase/admin";
import { TenantsClient } from "@/components/modules/tenants/tenants-client";
import type { TenantApplication } from "@/types";

export default async function TenantsPage() {
  const [data, ctx] = await Promise.all([getTenants(), getAuthContext()]);

  let applications: TenantApplication[] = [];
  let hostelSlug: string | null = null;

  if (ctx?.hostelId) {
    const admin = createAdminClient();
    const [appsResult, hostelResult] = await Promise.all([
      admin
        .from("hms_tenant_applications")
        .select("*")
        .eq("hostel_id", ctx.hostelId)
        .order("applied_at", { ascending: false }),
      admin
        .from("hms_hostels")
        .select("slug")
        .eq("id", ctx.hostelId)
        .single(),
    ]);
    applications = (appsResult.data ?? []) as TenantApplication[];
    hostelSlug = hostelResult.data?.slug ?? null;
  }

  return (
    <TenantsClient
      {...data}
      applications={applications}
      hostelSlug={hostelSlug}
    />
  );
}
