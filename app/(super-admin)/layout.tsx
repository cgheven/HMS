import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth";
import { SuperAdminShell } from "@/components/layout/super-admin-shell";

export default async function SuperAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The cache()d lookup, not its own getUser + profile SELECT. The layout runs
  // on every Super Admin navigation and used to pay two uncached round trips
  // that the page's own guard then paid again — with functions in us-east and
  // Postgres in Singapore, each was ~264ms. Sharing the cache means the whole
  // navigation authenticates once.
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "super_admin") redirect("/dashboard");

  return (
    <SuperAdminShell email={profile.email ?? ""}>
      {children}
    </SuperAdminShell>
  );
}
