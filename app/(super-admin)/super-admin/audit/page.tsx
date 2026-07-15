import { requireSuperAdmin } from "@/lib/auth";
import { listAuditLogs, listLoginLogs } from "@/app/actions/super-admin-audit";
import { SuperAdminAuditClient } from "@/components/modules/super-admin/audit-client";

export const dynamic = "force-dynamic";

export default async function SuperAdminAuditPage() {
  await requireSuperAdmin();

  const [{ logs = [] }, { logs: loginLogs = [] }] = await Promise.all([
    listAuditLogs(),
    listLoginLogs(),
  ]);

  return <SuperAdminAuditClient initialLogs={logs} initialLoginLogs={loginLogs} />;
}
