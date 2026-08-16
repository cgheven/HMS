import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options as Parameters<typeof supabaseResponse.cookies.set>[2])
          );
        },
      },
    }
  );

  // getSession() reads the JWT from the cookie — no network call.
  // Routing decisions (redirect to /login or /dashboard) don't need server validation.
  // Server components use getUser() (which validates + refreshes) for actual data access.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user ?? null;

  const { pathname } = request.nextUrl;
  const isAuthRoute = pathname.startsWith("/login");
  // Segment-boundary match (not a bare startsWith) so a future route like
  // /sales/login-history can't accidentally inherit public access.
  const isSalesLogin = pathname === "/sales/login" || pathname.startsWith("/sales/login/");
  const isPublic =
    isAuthRoute ||
    isSalesLogin ||
    pathname.startsWith("/find") ||
    pathname.startsWith("/onboarding") ||
    pathname.startsWith("/guide") ||
    pathname.startsWith("/join/") ||
    pathname.startsWith("/complaint/") ||
    // Tenant checkout feedback. Trailing slash on purpose, per the segment
    // -boundary note above — a bare "/fb" would hand public access to any
    // future sibling route, and the owner-facing /feedback page must stay
    // behind the auth gate.
    pathname.startsWith("/fb/") ||
    // Tenant referral links. Trailing slash for the same reason as "/fb/"
    // above — a bare "/ref" would hand public access to any future sibling
    // route, and the owner-facing /marketing page must stay behind the gate.
    // Password reset. Someone who cannot sign in must be able to reach both of
    // these, so they cannot sit behind the auth gate. Exact-match plus the
    // trailing-slash form, per the segment-boundary note above — a bare
    // startsWith would hand public access to any future sibling route.
    pathname === "/forgot-password" ||
    pathname.startsWith("/forgot-password/") ||
    pathname === "/reset-password" ||
    pathname.startsWith("/reset-password/") ||
    pathname.startsWith("/ref/") ||
    pathname.startsWith("/r/") ||
    pathname.startsWith("/invoice/") ||
    pathname.startsWith("/partner/login") ||
    pathname.startsWith("/pricing") ||
    // Server-to-server cron invocation — no user cookie, authenticates via
    // CRON_SECRET bearer token inside the route handler itself.
    pathname.startsWith("/api/cron/");

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    // Sales reps have their own dedicated login — bouncing them to the shared
    // Owner/Manager page (which no longer has a Sales tab) would strand them.
    url.pathname = pathname.startsWith("/sales") ? "/sales/login" : "/login";
    return NextResponse.redirect(url);
  }

  if (user && isAuthRoute) {
    // Redirect to root — app/page.tsx resolves the correct home by role
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
