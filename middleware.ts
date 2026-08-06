import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { brandedLabelFromHost } from "@/lib/subdomain";

/**
 * Crawler files must never be rewritten OR auth-gated.
 *
 * Two separate traps: on a branded host the subdomain rewrite would send them
 * to /s/{label}/robots.txt where no route exists, and on the main host the auth
 * gate redirects any unauthenticated request to /login — so Google fetching
 * hostel.yourpulse.io/robots.txt was getting a login redirect instead of rules.
 * Returning early sidesteps both without touching lib/supabase/middleware.ts.
 */
const CRAWLER_PATHS = new Set(["/robots.txt", "/sitemap.xml"]);

export async function middleware(request: NextRequest) {
  if (CRAWLER_PATHS.has(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  const label = brandedLabelFromHost(request.headers.get("host") ?? request.nextUrl.hostname);

  // Branded subdomains serve public listing pages only — no dashboard, no
  // session. Returning here means updateSession never runs for them, so the
  // auth gate in lib/supabase/middleware.ts is left completely untouched and
  // its pathname allowlist doesn't need to know this feature exists.
  //
  // A rewrite, not a redirect: the visitor's address bar keeps showing the
  // client's own domain. An unknown label still reaches /s/{label}, where the
  // page resolves nothing and renders a normal 404.
  if (label) {
    const url = request.nextUrl.clone();
    url.pathname = `/s/${label}${request.nextUrl.pathname === "/" ? "" : request.nextUrl.pathname}`;
    return NextResponse.rewrite(url);
  }

  return await updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
