import { getTenants } from "@/lib/data";
import { getAuthContext } from "@/lib/data";
import { createAdminClient } from "@/lib/supabase/admin";
import { TenantsClient } from "@/components/modules/tenants/tenants-client";
import type { TenantApplication, WaitlistEntry } from "@/types";

export default async function TenantsPage() {
  const [data, ctx] = await Promise.all([getTenants(), getAuthContext()]);

  let applications: TenantApplication[] = [];
  let hostelSlug: string | null = null;
  let waitlistEntries: WaitlistEntry[] = [];
  // Derived per tenant on the admission form: charged only to residents whose
  // room has AC, so the rate lives on the branch, not the tenant.
  let acMaintenanceRate = 0;

  if (ctx?.hostelId) {
    const admin = createAdminClient();
    const [appsResult, hostelResult, waitlistResult, configResult] = await Promise.all([
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
      admin
        .from("hms_waitlist")
        .select("id, hostel_id, name, phone, created_at")
        .eq("hostel_id", ctx.hostelId)
        .order("created_at", { ascending: false }),
      admin
        .from("hms_package_configs")
        .select("ac_maintenance_rate")
        .eq("hostel_id", ctx.hostelId)
        .maybeSingle(),
    ]);
    applications = (appsResult.data ?? []) as TenantApplication[];
    acMaintenanceRate = Number(configResult.data?.ac_maintenance_rate ?? 0);
    hostelSlug = hostelResult.data?.slug ?? null;
    waitlistEntries = (waitlistResult.data ?? []) as WaitlistEntry[];
  }

  return (
    <TenantsClient
      key={data.hostelId ?? ''}
      {...data}
      applications={applications}
      hostelSlug={hostelSlug}
      hostelName={ctx?.hostel?.name}
      mealTimes={ctx?.hostel?.meal_times}
      acMaintenanceRate={acMaintenanceRate}
      waitlistEntries={waitlistEntries}
      partnerTier={ctx?.partnerTier}
    />
  );
}
