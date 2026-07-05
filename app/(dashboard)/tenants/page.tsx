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

  if (ctx?.hostelId) {
    const admin = createAdminClient();
    const [appsResult, hostelResult, waitlistResult] = await Promise.all([
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
    ]);
    applications = (appsResult.data ?? []) as TenantApplication[];
    hostelSlug = hostelResult.data?.slug ?? null;
    waitlistEntries = (waitlistResult.data ?? []) as WaitlistEntry[];
  }

  return (
    <TenantsClient
      key={data.hostelId ?? ''}
      {...data}
      applications={applications}
      hostelSlug={hostelSlug}
      waitlistEntries={waitlistEntries}
    />
  );
}
