import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { SuperAdminShell } from "@/components/layout/super-admin-shell";

export default async function SuperAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Use service role to bypass RLS and read the role column
  const admin = createAdminClient();
  const { data: profile, error } = await admin
    .from("hms_profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (error || profile?.role !== "super_admin") redirect("/dashboard");

  return (
    <SuperAdminShell email={user.email ?? ""}>
      {children}
    </SuperAdminShell>
  );
}
