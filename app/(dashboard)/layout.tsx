import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/data";
import { HostelProvider } from "@/contexts/hostel-context";
import { DashboardShell } from "@/components/layout/dashboard-shell";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getAuthContext();
  // F-002: require authenticated user with owner or super_admin role.
  // Partner users must be redirected to the partner portal.
  if (!ctx?.user) redirect("/login");
  if (ctx.profile?.role === "super_admin") redirect("/super-admin");
  if (ctx.profile?.role === "partner") redirect("/partner");
  if (ctx.profile?.role !== "owner") redirect("/login");

  return (
    <HostelProvider profile={ctx.profile} hostel={ctx.hostel} hostels={ctx.hostels ?? []}>
      <DashboardShell>{children}</DashboardShell>
    </HostelProvider>
  );
}
