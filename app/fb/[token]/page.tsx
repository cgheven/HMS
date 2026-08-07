import { CheckCircle2 } from "lucide-react";
import type { Metadata } from "next";
import { resolveFeedbackToken } from "@/lib/tenant-feedback";
import { FeedbackFormClient } from "./feedback-form-client";

// The token is in the path, so any indexed copy of this URL is a live
// credential in a search result. noindex/nofollow here rides alongside the
// X-Robots-Tag and Referrer-Policy set for /fb/ in next.config.ts.
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

// Never prerendered, never cached. A shared or proxy cache that stored this
// page could serve one tenant's rendered state to the next visitor.
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ token: string }>;
}

export default async function FeedbackPage({ params }: Props) {
  const { token } = await params;

  const result = await resolveFeedbackToken(token);

  // ONE page for every non-live token — unknown, malformed, expired, revoked,
  // and already used alike. HTTP 200, deliberately not 404 or 410: a differing
  // status code is the easiest oracle in the world to script, and the resolver
  // gives this component no reason code to branch on even if someone wanted to.
  //
  // It names nothing. No hostel, no tenant, no previous answers — a forwarded
  // link must teach its holder nothing at all.
  if (!result) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center space-y-5 animate-fade-in">
          <div className="flex items-center justify-center w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 mx-auto">
            <CheckCircle2 className="w-8 h-8 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-2xl font-serif font-normal tracking-tight text-foreground">
              This feedback link is no longer active
            </h2>
            <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
              If you&apos;ve already sent your feedback, thank you — it&apos;s been recorded.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return <FeedbackFormClient token={token} hostelName={result.hostelName} />;
}
