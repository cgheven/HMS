import { redirect } from "next/navigation"
import { getManagersPageData } from "@/lib/managers-data"
import { getAuthContext } from "@/lib/data"
import { ManagersClient } from "@/components/modules/managers/managers-client"

export default async function ManagersPage() {
  // Account-level, so owner-only — creating/deleting manager logins writes
  // auth users and hms_profiles. The nav hides this from partners, but nav
  // visibility is not a security boundary: getManagersPageData reads through
  // createAdminClient(), which bypasses RLS entirely, so without this check a
  // partner reaching /managers directly would see the branch's manager roster.
  // Redirects to /dashboard rather than /login — the caller is authenticated,
  // just not authorised, and bouncing them to a login page they are already
  // past is confusing.
  const ctx = await getAuthContext()
  if (ctx?.profile?.role === "partner") redirect("/dashboard")

  const data = await getManagersPageData()
  return <ManagersClient key={data.hostelId ?? ''} {...data} />
}
