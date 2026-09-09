import { getTenants } from "@/lib/data";
import { getAuthContext } from "@/lib/data";
import { createAdminClient } from "@/lib/supabase/admin";
import { TenantsClient } from "@/components/modules/tenants/tenants-client";
import type { TenantApplication, WaitlistEntry } from "@/types";

export default async function TenantsPage() {
  const [data, ctx] = await Promise.all([getTenants(), getAuthContext()]);

  let applications: TenantApplication[] = [];
  let hostelSlug: string | null = null;
  let meterAllRooms = false;
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
        .select("slug, meter_all_rooms")
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
    meterAllRooms = !!hostelResult.data?.meter_all_rooms;
    waitlistEntries = (waitlistResult.data ?? []) as WaitlistEntry[];
  }

  // The OTHER branches this caller may move a member into — the destinations for
  // the "Move to another branch" control. An owner holds edit rights on every
  // branch they own; a partner needs FULL tier on both the current branch and the
  // destination, so partners see only their other full-tier branches. Managers use
  // the /portal tenants page, which computes its own list. The server action
  // re-checks all of this. An empty list hides the control.
  const role = ctx?.profile?.role;
  let branchTargets: { id: string; name: string }[] = [];
  if (ctx?.hostelId) {
    if (role === "owner" || role === "super_admin") {
      branchTargets = (ctx.hostels ?? []).filter((h) => h.id !== ctx.hostelId).map((h) => ({ id: h.id, name: h.name }));
    } else if (role === "partner" && ctx.partnerTier === "full") {
      const tierByHostel = ctx.partnerTierByHostel ?? {};
      // Same owner only — a partner may be full on branches of DIFFERENT owners,
      // but a transfer never crosses owners (the server enforces this too).
      const activeOwnerId = (ctx.hostels ?? []).find((h) => h.id === ctx.hostelId)?.owner_id;
      branchTargets = (ctx.hostels ?? [])
        .filter((h) => h.id !== ctx.hostelId && tierByHostel[h.id] === "full" && h.owner_id === activeOwnerId)
        .map((h) => ({ id: h.id, name: h.name }));
    }
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
      meterAllRooms={meterAllRooms}
      waitlistEntries={waitlistEntries}
      partnerTier={ctx?.partnerTier}
      branchTargets={branchTargets}
    />
  );
}
