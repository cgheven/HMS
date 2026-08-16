import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RECOVERY_COOKIE } from "@/lib/auth-recovery";
import { ResetPasswordClient } from "./reset-password-client";

export const metadata: Metadata = { title: "Set a new password", robots: { index: false, follow: false } };

/**
 * Server component on purpose.
 *
 * The gate is the httpOnly marker set by /auth/confirm, NOT "does a session
 * exist". An earlier version checked only for a session, which made this page a
 * password-change form for anyone already signed in — no recovery link and no
 * re-authentication — so any borrowed or hijacked session was a complete
 * account-takeover primitive. A client cannot set this cookie; only the confirm
 * route can, and only after verifying a real token.
 */
export default async function ResetPasswordPage() {
  const jar = await cookies();
  const cameFromRecovery = jar.get(RECOVERY_COOKIE)?.value === "1";

  if (!cameFromRecovery) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-sm text-center space-y-5">
          <div className="flex items-center justify-center w-14 h-14 rounded-full bg-amber/10 border border-amber/20 mx-auto">
            <TriangleAlert className="w-7 h-7 text-amber" />
          </div>
          <div>
            <h1 className="text-2xl font-serif tracking-tight">This link is no longer valid</h1>
            <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
              Reset links expire quickly and can only be used once. Request a new one.
            </p>
          </div>
          <Link href="/forgot-password"><Button className="w-full">Request a new link</Button></Link>
        </div>
      </div>
    );
  }

  return <ResetPasswordClient />;
}
