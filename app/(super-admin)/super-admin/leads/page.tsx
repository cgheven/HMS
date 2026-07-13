import { requireSuperAdmin } from "@/lib/auth";
import { listLeadsForAdmin } from "@/app/actions/leads";
import { listSalesReps } from "@/app/actions/sales-reps";
import { SuperAdminLeadsClient } from "@/components/modules/super-admin/leads-client";

export const dynamic = "force-dynamic";

export default async function SuperAdminLeadsPage() {
  const profile = await requireSuperAdmin();

  const [leadsRes, repsRes] = await Promise.all([listLeadsForAdmin(), listSalesReps()]);

  const leads = "leads" in leadsRes ? leadsRes.leads : [];
  const salesReps = "reps" in repsRes ? repsRes.reps : [];

  return <SuperAdminLeadsClient initialLeads={leads} salesReps={salesReps} adminUserId={profile.id} />;
}
