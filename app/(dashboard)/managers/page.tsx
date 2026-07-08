import { getManagersPageData } from "@/lib/managers-data"
import { ManagersClient } from "@/components/modules/managers/managers-client"

export default async function ManagersPage() {
  const data = await getManagersPageData()
  return <ManagersClient key={data.hostelId ?? ''} {...data} />
}
