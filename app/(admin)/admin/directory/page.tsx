import { getPublicHostels } from "@/app/actions/public";
import { FindClient } from "@/components/find/find-client";

export const dynamic = "force-dynamic";

export default async function AdminDirectoryPage() {
  const { hostels = [] } = await getPublicHostels();
  return <FindClient hostels={hostels} />;
}
