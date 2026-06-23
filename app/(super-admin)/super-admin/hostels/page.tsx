import { requireSuperAdmin } from "@/lib/auth";
import { listAllHostels } from "@/app/actions/super-admin";
import { SuperAdminHostelsClient } from "@/components/modules/super-admin/hostels-client";

export const dynamic = "force-dynamic";

export default async function SuperAdminHostelsPage() {
  await requireSuperAdmin();

  const res = await listAllHostels();
  const hostels = res.hostels ?? [];

  return <SuperAdminHostelsClient initialHostels={hostels} />;
}
