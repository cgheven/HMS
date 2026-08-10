import { getAuthContext } from "@/lib/data";
import { WebsiteClient } from "@/components/modules/website/website-client";

export default async function WebsitePage() {
  // One await, not a Promise.all: getAuthContext is React cache()-wrapped and the
  // dashboard layout already resolved it this request, so this is a cache hit and
  // zero extra DB round trips. hms_profiles is fetched there with select("*"), so
  // every account-level public-site column rides along — re-querying them would
  // be the duplicate work rule 7 forbids.
  const ctx = await getAuthContext();
  const p = ctx?.profile ?? null;
  // No role redirect here, unlike billing/page.tsx: partners must reach this page
  // for the branding and Public Listing cards, which they have today in Settings.
  return (
    <WebsiteClient
      key={ctx?.hostelId ?? ""}
      hostelId={ctx?.hostelId ?? null}
      initialSubdomain={p?.subdomain ?? null}
      // Premium gate (migration 167). Rides along in the same select("*") as
      // everything else here. The card renders locked rather than hidden: a
      // client who cannot use this should still learn it exists.
      subdomainEnabled={(p as { subdomain_enabled?: boolean } | null)?.subdomain_enabled === true}
      initialBusinessName={p?.business_name ?? ""}
      initialLogoUrl={p?.logo_url ?? null}
      initialInstagram={p?.instagram_handle ?? ""}
      initialFacebook={p?.facebook_handle ?? ""}
      // NULL resolves to light here, the same rule app/actions/public.ts applies
      // when serving the page: light is what every client is served today, so an
      // owner who never opens this control is never flipped.
      initialTheme={p?.public_theme === "dark" ? "dark" : "light"}
    />
  );
}
