import { getTenants } from "@/lib/data";
import { TenantsClient } from "@/components/modules/tenants/tenants-client";

export default async function TenantsPage() {
  const data = await getTenants();
  return <TenantsClient {...data} />;
}
