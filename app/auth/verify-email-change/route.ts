import { NextRequest, NextResponse } from "next/server";
import { verifyEmailChange } from "@/app/actions/account";
import { siteUrl } from "@/lib/site-url";

// Email-change confirmation landing. The `token` query param IS the credential;
// it is single-use and consumed server-side. The link is clicked from the NEW
// inbox (possibly in a different browser with no session), so this needs no auth
// beyond the token. On success we bounce to sign-in — the login email just
// changed, so the owner should re-authenticate with it.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const origin = siteUrl();
  const token = req.nextUrl.searchParams.get("token") ?? "";

  const result = await verifyEmailChange(token);

  const url = new URL("/login", origin);
  if ("ok" in result) {
    url.searchParams.set("message", "Your email has been updated. Please sign in with your new email.");
  } else {
    url.searchParams.set("message", result.error);
  }
  return NextResponse.redirect(url);
}
