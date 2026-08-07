import { requireSuperAdmin } from "@/lib/auth";
import { listWhatsAppLog } from "@/app/actions/whatsapp-monitor";
import { WhatsAppMonitorClient } from "@/components/modules/super-admin/whatsapp-monitor-client";

export const dynamic = "force-dynamic";

export default async function SuperAdminWhatsAppPage() {
  await requireSuperAdmin();

  const { rows, stats } = await listWhatsAppLog(30);

  return (
    <WhatsAppMonitorClient
      rows={rows ?? []}
      stats={stats ?? { total: 0, delivered: 0, pending: 0, undelivered: 0, failed: 0 }}
    />
  );
}
