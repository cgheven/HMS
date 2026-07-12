import "server-only"
import { cache } from "react"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import type { SalesRep, SalesRepContext, SalesTarget } from "@/types"

export const getSalesRepContext = cache(async (): Promise<SalesRepContext | null> => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const admin = createAdminClient()

  // is_active gate: a deactivated rep must be locked out on their very next request.
  const { data: rep } = await admin
    .from("hms_sales_reps")
    .select("*, target:hms_sales_targets(*)")
    .eq("supabase_user_id", user.id)
    .eq("is_active", true)
    .maybeSingle()

  if (!rep) return null

  const { target, ...rest } = rep as SalesRep & { target: SalesTarget[] | SalesTarget | null }
  const salesRep: SalesRep = {
    ...rest,
    target: Array.isArray(target) ? (target[0] ?? null) : (target ?? null),
  }

  return { salesRep }
})

export async function requireSalesAuth(): Promise<SalesRepContext> {
  const ctx = await getSalesRepContext()
  if (!ctx) redirect("/sales/login")
  return ctx
}
