import { requireSuperAdmin } from "@/lib/auth";
import { getSuperAdminStats, getClientSummaries } from "@/app/actions/super-admin";
import { SuperAdminDashboardClient } from "@/components/modules/super-admin/dashboard-client";

export const dynamic = "force-dynamic";

export default async function SuperAdminDashboardPage() {
  await requireSuperAdmin();

  const [statsRes, clientsRes] = await Promise.all([getSuperAdminStats(), getClientSummaries()]);

  const stats = statsRes.stats ?? {
    collected: 0,
    outstanding: 0,
    overdue: 0,
    mrr: 0,
    totalClients: 0,
    unbilledClients: 0,
    totalBranches: 0,
    totalActiveTenants: 0,
  };

  return <SuperAdminDashboardClient stats={stats} clients={clientsRes.clients ?? []} />;
}
