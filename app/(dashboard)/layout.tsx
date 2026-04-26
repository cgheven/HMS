import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { HostelProvider } from "@/contexts/hostel-context";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import type { Profile, Hostel } from "@/types";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Fetch profile + hostel server-side — no client waterfall
  const [{ data: profile }, { data: hostel }] = await Promise.all([
    supabase.from("hms_profiles").select("*").eq("id", user.id).single(),
    supabase.from("hms_hostels").select("*").eq("owner_id", user.id).single(),
  ]);

  return (
    <HostelProvider profile={profile as Profile | null} hostel={hostel as Hostel | null}>
      <DashboardShell>{children}</DashboardShell>
    </HostelProvider>
  );
}
