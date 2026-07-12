import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // hms_managers / hms_sales_reps have RLS enabled with zero policies (default-deny
  // even for the row owner) — these self-lookups must use the admin client, not the
  // anon-key client, or they silently always return null.
  const admin = createAdminClient();
  const [{ data: profile }, { data: manager }, { data: salesRep }] = await Promise.all([
    supabase.from("hms_profiles").select("role").eq("id", user.id).single(),
    admin.from("hms_managers").select("id").eq("supabase_user_id", user.id).maybeSingle(),
    admin
      .from("hms_sales_reps")
      .select("id")
      .eq("supabase_user_id", user.id)
      .eq("is_active", true)
      .maybeSingle(),
  ]);

  if (manager) redirect("/portal");
  if (salesRep) redirect("/sales");

  const home =
    profile?.role === "super_admin" ? "/super-admin"
    : profile?.role === "partner" ? "/partner"
    : "/dashboard";

  redirect(home);
}
