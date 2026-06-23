import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PartnerShell } from "@/components/layout/partner-shell";

export default async function PartnerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/partner/login");

  const admin = createAdminClient();

  // Verify the user has an active partnership
  const { data: partnership } = await admin
    .from("hms_partnerships")
    .select("hostel_id")
    .eq("partner_id", user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (!partnership) redirect("/partner/login");

  // Fetch hostel name for the shell
  const { data: hostel } = await admin
    .from("hms_hostels")
    .select("name")
    .eq("id", partnership.hostel_id)
    .single();

  return (
    <PartnerShell hostelName={hostel?.name ?? "Hostel"}>
      {children}
    </PartnerShell>
  );
}
