import { requireSalesAuth } from "@/lib/sales-auth"
import { listMyLeads, getMyPerformance } from "@/app/actions/leads"
import { SalesDashboardClient } from "@/components/modules/sales/sales-dashboard-client"

export const dynamic = "force-dynamic"

export default async function SalesPage() {
  const ctx = await requireSalesAuth()

  const [leadsRes, performanceRes] = await Promise.all([
    listMyLeads(),
    getMyPerformance(),
  ])

  const leads = "leads" in leadsRes ? leadsRes.leads : []
  const performance = "error" in performanceRes ? null : performanceRes

  return (
    <SalesDashboardClient
      key={ctx.salesRep.id}
      initialLeads={leads}
      performance={performance}
    />
  )
}
