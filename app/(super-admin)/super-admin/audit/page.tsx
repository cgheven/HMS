import { requireSuperAdmin } from "@/lib/auth";
import { listAuditLogs, listLoginLogs, listClientActivity, listActivityFeed } from "@/app/actions/super-admin-audit";
import { SuperAdminAuditClient } from "@/components/modules/super-admin/audit-client";

export const dynamic = "force-dynamic";

export default async function SuperAdminAuditPage() {
  await requireSuperAdmin();

  const [{ logs = [] }, { logs: loginLogs = [] }, { rows: activity = [] }, { events: feed = [] }] = await Promise.all([
    listAuditLogs(),
    listLoginLogs(),
    listClientActivity(),
    listActivityFeed(),
  ]);

  return (
    <SuperAdminAuditClient
      initialLogs={logs}
      initialLoginLogs={loginLogs}
      initialActivity={activity}
      initialFeed={feed}
    />
  );
}
