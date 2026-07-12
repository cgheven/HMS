import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/data";
import { createAdminClient } from "@/lib/supabase/admin";
import { HostelProvider } from "@/contexts/hostel-context";
import { DashboardShell } from "@/components/layout/dashboard-shell";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getAuthContext();
  // F-002: require authenticated user with owner or super_admin role.
  // Partner users must be redirected to the partner portal.
  if (!ctx?.user) redirect("/login");
  if (ctx.profile?.role === "super_admin") redirect("/super-admin");
  if (ctx.profile?.role === "partner") redirect("/partner");

  // Defense-in-depth: an auth user linked to hms_sales_reps must never reach the
  // owner dashboard, independent of hms_profiles.role — this closes the gap even
  // if a future signup-trigger regression again mislabels a staff account as 'owner'.
  const { data: salesRep } = await createAdminClient()
    .from("hms_sales_reps")
    .select("id")
    .eq("supabase_user_id", ctx.user.id)
    .eq("is_active", true)
    .maybeSingle();
  if (salesRep) redirect("/sales");

  if (ctx.profile?.role !== "owner") redirect("/login");

  return (
    <HostelProvider profile={ctx.profile} hostel={ctx.hostel} hostels={ctx.hostels ?? []}>
      <DashboardShell>{children}</DashboardShell>
    </HostelProvider>
  );
}
