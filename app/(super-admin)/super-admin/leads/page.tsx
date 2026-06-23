import { requireSuperAdmin } from "@/lib/auth";
import { listLeads } from "@/app/actions/super-admin";
import { SuperAdminLeadsClient } from "@/components/modules/super-admin/leads-client";

export const dynamic = "force-dynamic";

export default async function SuperAdminLeadsPage() {
  await requireSuperAdmin();

  const res = await listLeads();
  const leads = res.leads ?? [];

  return <SuperAdminLeadsClient initialLeads={leads} />;
}
