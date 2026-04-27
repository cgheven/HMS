import { getPublicHostels } from "@/app/actions/public";
import { FindClient } from "@/components/find/find-client";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Find a Hostel — HMS Directory",
  description: "Browse verified hostels. Contact directly with no fees.",
};

export default async function FindPage() {
  const { hostels = [] } = await getPublicHostels();
  return <FindClient hostels={hostels} />;
}
