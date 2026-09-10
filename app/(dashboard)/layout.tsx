import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/data";
import { createAdminClient } from "@/lib/supabase/admin";
import { HostelProvider } from "@/contexts/hostel-context";
import { DashboardShell } from "@/components/layout/dashboard-shell";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getAuthContext();
  // F-002: require authenticated user with owner, partner, or super_admin role.
  if (!ctx?.user) redirect("/login");
  if (ctx.profile?.role === "super_admin") redirect("/super-admin");

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

  if (!["owner", "partner"].includes(ctx.profile?.role ?? "")) redirect("/login");
  // A partner with no active branch (all partnerships removed) has nothing to see here.
  if (ctx.profile?.role === "partner" && !ctx.hostel) redirect("/login");

  // Account suspension (unpaid dues): owner = own flag; partner = the account
  // owner's flag. Reads still work; the banner explains why writes are blocked.
  let accountFrozen = false;
  if (ctx.profile?.role === "owner") {
    accountFrozen = !!ctx.profile.frozen;
  } else if (ctx.hostel?.owner_id) {
    const { data } = await createAdminClient()
      .from("hms_profiles").select("frozen").eq("id", ctx.hostel.owner_id).maybeSingle();
    accountFrozen = !!(data as { frozen?: boolean } | null)?.frozen;
  }

  return (
    <HostelProvider profile={ctx.profile} hostel={ctx.hostel} hostels={ctx.hostels ?? []} partnerTier={ctx.partnerTier}>
      <DashboardShell>
        {accountFrozen && (
          <div className="mb-4 rounded-xl border border-amber/30 bg-amber/10 px-4 py-3 text-sm">
            <span className="font-semibold text-amber">Account suspended.</span>{" "}
            Your account has unpaid dues, so changes are disabled — you can still view everything.
            Clear your balance to restore full access.
          </div>
        )}
        {children}
      </DashboardShell>
    </HostelProvider>
  );
}
