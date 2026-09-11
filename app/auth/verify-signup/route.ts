import { NextRequest, NextResponse } from "next/server";
import { verifySignupAndProvision } from "@/app/actions/signup";
import { siteUrl } from "@/lib/site-url";

// Public signup email-verification landing. The `token` query param IS the
// credential; it is single-use and consumed server-side. On success the owner
// account is created and we hand the browser a set-password recovery link; on
// failure we bounce to sign-in with a message. Node runtime + no caching so the
// token is never reused from a cache.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const origin = siteUrl();
  const token = req.nextUrl.searchParams.get("token") ?? "";

  const result = await verifySignupAndProvision(token);

  if ("actionLink" in result) {
    return NextResponse.redirect(result.actionLink);
  }
  const url = new URL("/login", origin);
  url.searchParams.set("message", result.error);
  return NextResponse.redirect(url);
}
