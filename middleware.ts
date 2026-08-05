import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Branded client subdomains: {label}.hostels.yourpulse.io serves the public
// listing that also lives at /find/{slug}. Hardcoded rather than read from an
// env var on purpose — an unset variable in one environment would silently turn
// every client's branded domain into a login redirect.
const BRANDED_ROOT = ".hostels.yourpulse.io";

// Local development equivalent. Chrome and Safari resolve *.localhost to
// loopback with no /etc/hosts entry, so http://chohanexecutive.localhost:3000
// exercises the real subdomain path. Bare "localhost" is NOT a subdomain and
// must keep behaving exactly as it does today.
const DEV_ROOT = ".localhost";

// A DNS label: lowercase alphanumeric with inner hyphens, 3..63 chars. Mirrors
// the CHECK constraint on hms_profiles.subdomain. Validating here means the
// label can never carry a slash, dot, or traversal sequence into the rewritten
// pathname below — the Host header is attacker-controlled input.
const LABEL = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

function brandedLabel(request: NextRequest): string | null {
  const raw = request.headers.get("host") ?? request.nextUrl.hostname;
  if (!raw) return null;

  // Strip port, normalise case. A Host header is never percent-encoded.
  const hostname = raw.split(":")[0].trim().toLowerCase();

  const root = hostname.endsWith(BRANDED_ROOT)
    ? BRANDED_ROOT
    : hostname.endsWith(DEV_ROOT)
      ? DEV_ROOT
      : null;
  if (!root) return null;

  const label = hostname.slice(0, -root.length);
  // Rejects the apex ("hostels.yourpulse.io"), empty labels, and anything
  // deeper than one level ("a.b.hostels.yourpulse.io"), all of which fall
  // through to the normal app instead of resolving to a client.
  return LABEL.test(label) ? label : null;
}

export async function middleware(request: NextRequest) {
  const label = brandedLabel(request);

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
