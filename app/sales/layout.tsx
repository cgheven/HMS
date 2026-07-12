import { requireSalesAuth } from "@/lib/sales-auth"
import { SalesShell } from "@/components/layout/sales-shell"

export default async function SalesLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireSalesAuth()

  return <SalesShell salesRep={ctx.salesRep}>{children}</SalesShell>
}
