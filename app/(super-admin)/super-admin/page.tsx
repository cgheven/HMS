import { requireSuperAdmin } from "@/lib/auth";
import { getSuperAdminStats, listAllHostels, getRecentLeads } from "@/app/actions/super-admin";
import { SuperAdminDashboardClient } from "@/components/modules/super-admin/dashboard-client";

export const dynamic = "force-dynamic";

export default async function SuperAdminDashboardPage() {
  await requireSuperAdmin();

  const [statsRes, hostelsRes, leadsRes] = await Promise.all([
    getSuperAdminStats(),
    listAllHostels(),
    getRecentLeads(10),
  ]);

  const stats = statsRes.stats ?? {
    totalHostels: 0,
    totalActiveTenants: 0,
    totalRevenueThisMonth: 0,
    newLeadsThisMonth: 0,
  };

  // Show only the 5 most recently added hostels in the summary table
  const hostelsSummary = (hostelsRes.hostels ?? []).slice(0, 5);
  const recentLeads = leadsRes.leads ?? [];

  return (
    <SuperAdminDashboardClient
      stats={stats}
      recentLeads={recentLeads}
      hostelsSummary={hostelsSummary}
    />
  );
}
