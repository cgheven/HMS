import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("hms_profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  const home =
    profile?.role === "super_admin" ? "/super-admin"
    : profile?.role === "partner" ? "/partner"
    : "/dashboard";

  redirect(home);
}
