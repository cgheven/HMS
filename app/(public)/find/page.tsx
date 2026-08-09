import { redirect, notFound } from "next/navigation";
import { getAuthContext } from "@/lib/data";

export const dynamic = "force-dynamic";

// The global "browse every hostel" marketplace no longer exists as a public
// page — it moved to /admin/directory (admin-only). A logged-in owner visiting
// /find still gets sent to their own business page; everyone else gets 404.
export default async function FindPage() {
  const ctx = await getAuthContext();
  if (ctx?.hostel?.slug && ctx.hostel.listing_enabled) {
    redirect(`/find/${ctx.hostel.slug}`);
  }

  notFound();
}
