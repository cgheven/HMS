import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/data";
import { HostelProvider } from "@/contexts/hostel-context";
import { DashboardShell } from "@/components/layout/dashboard-shell";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Shared with all page data functions via React cache() — no duplicate DB calls
  const ctx = await getAuthContext();
  if (!ctx?.user) redirect("/login");

  return (
    <HostelProvider profile={ctx.profile} hostel={ctx.hostel}>
      <DashboardShell>{children}</DashboardShell>
    </HostelProvider>
  );
}
