import { requireSuperAdmin } from "@/lib/auth";
import { listSalesReps } from "@/app/actions/sales-reps";
import { getSalesPerformance } from "@/app/actions/leads";
import { SalesTeamClient } from "@/components/modules/super-admin/sales-team-client";

export const dynamic = "force-dynamic";

export default async function SalesTeamPage() {
  await requireSuperAdmin();

  const [repsRes, performanceRes] = await Promise.all([listSalesReps(), getSalesPerformance()]);

  const reps = "reps" in repsRes ? repsRes.reps : [];
  const performance = "performance" in performanceRes ? performanceRes.performance : [];

  return <SalesTeamClient initialReps={reps} initialPerformance={performance} />;
}
