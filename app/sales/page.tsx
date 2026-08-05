import { requireSalesAuth } from "@/lib/sales-auth"
import { listMyLeads, getMyPerformance } from "@/app/actions/leads"
import { LeadsClient } from "@/components/modules/leads/leads-client"
import { SalesStatsStrip } from "@/components/modules/sales/sales-stats-strip"

export const dynamic = "force-dynamic"

export default async function SalesPage() {
  const ctx = await requireSalesAuth()

  const [leadsRes, performanceRes] = await Promise.all([
    listMyLeads(),
    getMyPerformance(),
  ])

  const leads = "leads" in leadsRes ? leadsRes.leads : []
  const performance = "error" in performanceRes ? null : performanceRes

  // Same leads table Super Admin uses, in "rep" mode — assignment, deletion,
  // conversion and the follow-up digest are hidden because those actions are
  // requireSuperAdmin server-side. The targets strip stays above it: it's the
  // one thing a rep has that an admin's view of the same leads does not.
  return (
    <div className="space-y-5">
      {performance && (
        <SalesStatsStrip
          today={performance.today}
          week={performance.week}
          target={performance.target}
        />
      )}
      <LeadsClient key={ctx.salesRep.id} mode="rep" initialLeads={leads} />
    </div>
  )
}
